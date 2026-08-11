const { URLSearchParams } = require('node:url');

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SEND_BASE_URL = 'https://fcm.googleapis.com/v1/projects';
const ACTIVE = 'active';
const DEFAULT_ROUTE = '/chat';
const MAX_USER_IDS = 500;
const MAX_DEVICES = 500;
const MAX_TOKEN_LENGTH = 4096;
const DEFAULT_TIMEOUT_MS = 10_000;
const ALLOWED_ROUTES = new Set([DEFAULT_ROUTE]);
const SAFE_FAILURE_CODES = new Set([
  'authorization_failed',
  'delivery_failed',
  'invalid_argument',
  'temporary_failure',
  'token_decryption_failed',
  'transport_error',
  'unregistered'
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// FCM registration tokens are opaque. Accept bounded printable ASCII rather
// than guessing a provider-specific alphabet, while rejecting whitespace,
// control characters, and Unicode confusables.
const DEVICE_TOKEN_PATTERN = /^[\x21-\x7E]+$/;

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function normalizeUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return '';
  return value.toLowerCase();
}

function normalizeRoute(value) {
  return typeof value === 'string' && ALLOWED_ROUTES.has(value) ? value : DEFAULT_ROUTE;
}

function normalizeUserIds(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Set();
  for (const candidate of value) {
    const id = normalizeUuid(candidate);
    if (id) unique.add(id);
    if (unique.size >= MAX_USER_IDS) break;
  }
  return [...unique];
}

function validDeviceToken(value) {
  return typeof value === 'string'
    && value.length >= 32
    && value.length <= MAX_TOKEN_LENGTH
    && DEVICE_TOKEN_PATTERN.test(value);
}

function validTokenSecret(value) {
  return typeof value === 'string'
    && value.length >= 32
    && value.trim() === value
    && !/^(change-me-please|your-long-random-secret|generated-by-installer)$/i.test(value)
    && !/^(.)\1+$/.test(value);
}

function normalizedErrorStatus(value) {
  return typeof value === 'string' && /^[A-Z_]{2,64}$/.test(value) ? value : '';
}

function deliveryFailure(httpStatus, payload) {
  const error = payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object'
    ? payload.error
    : (payload && typeof payload === 'object' ? payload : {});
  const status = normalizedErrorStatus(error.status);
  const details = Array.isArray(error.details) ? error.details : [];
  const fcmCodes = details
    .filter((detail) => detail && typeof detail === 'object'
      && String(detail['@type'] || '').includes('google.firebase.fcm.v1.FcmError'))
    .map((detail) => normalizedErrorStatus(detail.errorCode))
    .filter(Boolean);

  if (httpStatus === 401 || httpStatus === 403 || status === 'UNAUTHENTICATED' || status === 'PERMISSION_DENIED') {
    return { code: 'authorization_failed', invalid: false, authorization: true };
  }
  if (status === 'UNREGISTERED' || fcmCodes.includes('UNREGISTERED')) {
    return { code: 'unregistered', invalid: true, authorization: false };
  }
  // A top-level INVALID_ARGUMENT can describe the message payload. Only the
  // typed FCM detail proves that the registration token itself is invalid.
  if (fcmCodes.includes('INVALID_ARGUMENT')) {
    return { code: 'invalid_argument', invalid: true, authorization: false };
  }
  if ([408, 429, 500, 502, 503, 504].includes(httpStatus)
    || ['ABORTED', 'DEADLINE_EXCEEDED', 'INTERNAL', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'UNKNOWN'].includes(status)) {
    return { code: 'temporary_failure', invalid: false, authorization: false };
  }
  return { code: 'delivery_failed', invalid: false, authorization: false };
}

async function runWithConcurrency(items, limit, worker) {
  const queue = Array.isArray(items) ? [...items] : [];
  const workerCount = Math.min(Math.max(Number(limit) || 1, 1), queue.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch (_) {
        // A single device must never create an unhandled rejection or stop the batch.
      }
    }
  }));
}

function createFcmPushService({
  crypto,
  tokenSecret,
  fcmServiceAccountJson = '',
  fetchImpl = globalThis.fetch,
  query,
  requireUser,
  ok,
  fail,
  uuid,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const tokenProtectionConfigured = validTokenSecret(tokenSecret)
    && crypto
    && typeof crypto.createHmac === 'function'
    && typeof crypto.createHash === 'function'
    && typeof crypto.createCipheriv === 'function'
    && typeof crypto.createDecipheriv === 'function';
  const timeoutMs = Number.isFinite(Number(requestTimeoutMs))
    ? Math.min(30_000, Math.max(10, Math.floor(Number(requestTimeoutMs))))
    : DEFAULT_TIMEOUT_MS;
  let accessTokenCache = null;
  let accessTokenPromise = null;

  function parseServiceAccount() {
    const raw = String(fcmServiceAccountJson || '').trim();
    if (!raw || !crypto || typeof crypto.createPrivateKey !== 'function') return null;
    try {
      const account = JSON.parse(raw);
      if (!account || account.type !== 'service_account'
        || typeof account.client_email !== 'string' || !account.client_email.trim()
        || typeof account.project_id !== 'string' || !account.project_id.trim()
        || typeof account.private_key !== 'string' || !account.private_key.includes('BEGIN PRIVATE KEY')) return null;
      const privateKey = crypto.createPrivateKey(account.private_key);
      if (privateKey.asymmetricKeyType !== 'rsa') return null;
      return Object.freeze({
        clientEmail: account.client_email.trim(),
        privateKey,
        projectId: account.project_id.trim()
      });
    } catch (_) {
      return null;
    }
  }

  const account = parseServiceAccount();

  function tokenHash(value) {
    if (!tokenProtectionConfigured) throw new Error('Push token protection is unavailable.');
    return crypto.createHmac('sha256', tokenSecret).update(value, 'utf8').digest('hex');
  }

  function encryptionKey() {
    if (!tokenProtectionConfigured) throw new Error('Push token protection is unavailable.');
    return crypto.createHash('sha256').update(`fcm-device-token:${tokenSecret}`, 'utf8').digest();
  }

  function encryptToken(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  function decryptToken(value) {
    if (typeof value !== 'string' || value.length > 8192) throw new Error('Encrypted push token is invalid.');
    const parts = value.split('.');
    if (parts.length !== 4) throw new Error('Encrypted push token is invalid.');
    const [version, iv, tag, body] = parts;
    if (version !== 'v1' || !iv || !tag || !body) throw new Error('Encrypted push token is invalid.');
    const ivBytes = Buffer.from(iv, 'base64url');
    const tagBytes = Buffer.from(tag, 'base64url');
    const bodyBytes = Buffer.from(body, 'base64url');
    if (ivBytes.length !== 12 || tagBytes.length !== 16 || bodyBytes.length < 32 || bodyBytes.length > MAX_TOKEN_LENGTH) {
      throw new Error('Encrypted push token is invalid.');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), ivBytes);
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([decipher.update(bodyBytes), decipher.final()]).toString('utf8');
  }

  function isConfigured() {
    return Boolean(tokenProtectionConfigured && account && typeof fetchImpl === 'function');
  }

  async function requestJson(url, init) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(new Error('FCM request timed out.'));
      }, timeoutMs);
    });
    const request = Promise.resolve().then(async () => {
      const response = await fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) });
      let body = {};
      try {
        body = response && typeof response.json === 'function' ? await response.json() : {};
      } catch (_) {
        body = {};
      }
      return { response, body: body && typeof body === 'object' ? body : {} };
    });
    try {
      return await Promise.race([request, timeout]);
    } catch (_) {
      // Never propagate fetch errors because they may contain request headers or tokens.
      throw new Error('FCM request failed.');
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestAccessToken() {
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = base64url(JSON.stringify({
        iss: account.clientEmail,
        scope: FCM_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        iat: now,
        exp: now + 3600
      }));
      const input = `${header}.${claims}`;
      const signer = crypto.createSign('RSA-SHA256');
      signer.update(input, 'utf8');
      signer.end();
      const assertion = `${input}.${signer.sign(account.privateKey).toString('base64url')}`;
      const { response, body } = await requestJson(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion
        }).toString()
      });
      const value = typeof body.access_token === 'string' ? body.access_token : '';
      if (!response?.ok || value.length < 8 || value.length > 8192 || /\s/.test(value)) {
        throw new Error('FCM authorization response is invalid.');
      }
      const parsedLifetime = Number(body.expires_in);
      const lifetimeSeconds = Number.isFinite(parsedLifetime) && parsedLifetime >= 60 && parsedLifetime <= 86_400
        ? Math.floor(parsedLifetime)
        : 3600;
      return { value, expiresAt: Date.now() + lifetimeSeconds * 1000 };
    } catch (_) {
      throw new Error('FCM authorization is unavailable.');
    }
  }

  async function getAccessToken(rejectedToken = '') {
    if (rejectedToken && accessTokenCache?.value === rejectedToken) accessTokenCache = null;
    if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) return accessTokenCache.value;
    if (accessTokenPromise) return accessTokenPromise;

    const pending = requestAccessToken().then((next) => {
      accessTokenCache = next;
      return next.value;
    });
    accessTokenPromise = pending;
    try {
      return await pending;
    } finally {
      if (accessTokenPromise === pending) accessTokenPromise = null;
    }
  }

  async function registerPushDevice(payload = {}, auth) {
    const user = await requireUser(auth);
    const userId = normalizeUuid(user?.id);
    const token = payload?.token;
    const platform = payload?.platform === undefined ? 'android' : payload.platform;
    if (!userId || !validDeviceToken(token)) return fail('Invalid push device request.', 400, 2001);
    if (platform !== 'android') return fail('Only Android push devices are supported.', 400, 2001);
    if (!tokenProtectionConfigured) return fail('Push notifications are unavailable.', 503, 5000);

    try {
      // token_hash is unique. Possession of a device token atomically moves that
      // one token to the currently authenticated account, preventing the prior
      // account from continuing to receive notifications after an account switch.
      await query(`
        insert into user_push_devices (id, user_id, platform, token_hash, token_ciphertext, status, last_seen_at, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,now(),now(),now())
        on conflict (token_hash) do update set user_id = excluded.user_id, platform = excluded.platform,
          token_ciphertext = excluded.token_ciphertext, status = $6, failure_count = 0, last_error_code = null,
          last_seen_at = now(), invalidated_at = null, updated_at = now()
      `, [uuid(), userId, platform, tokenHash(token), encryptToken(token), ACTIVE]);
      return ok({ registered: true, platform });
    } catch (_) {
      return fail('Push device registration failed.', 503, 5000);
    }
  }

  async function unregisterPushDevice(payload = {}, auth) {
    const user = await requireUser(auth);
    const userId = normalizeUuid(user?.id);
    const token = payload?.token;
    if (!userId || !validDeviceToken(token)) return fail('Invalid push device request.', 400, 2001);
    if (!tokenProtectionConfigured) return fail('Push notifications are unavailable.', 503, 5000);
    try {
      await query(`update user_push_devices set status = 'revoked', invalidated_at = now(), updated_at = now()
        where user_id = $1 and token_hash = $2 and status = $3`, [userId, tokenHash(token), ACTIVE]);
      // The response is intentionally idempotent and does not disclose ownership.
      return ok({ revoked: true });
    } catch (_) {
      return fail('Push device removal failed.', 503, 5000);
    }
  }

  async function getMyPushStatus(_params = {}, auth) {
    const user = await requireUser(auth);
    const userId = normalizeUuid(user?.id);
    if (!userId) return fail('Invalid push device request.', 400, 2001);
    try {
      const rows = await query(`select count(*) filter (where status = $2)::int as active_device_count
        from user_push_devices where user_id = $1`, [userId, ACTIVE]);
      return ok({
        configured: isConfigured(),
        active_device_count: Math.max(0, Number(rows[0]?.active_device_count) || 0)
      });
    } catch (_) {
      return fail('Push notification status is unavailable.', 503, 5000);
    }
  }

  async function recordDeliveryFailure(id, code, invalid = false) {
    const safeCode = SAFE_FAILURE_CODES.has(code) ? code : 'delivery_failed';
    await query(`update user_push_devices set
      status = case when $3 then 'invalid' else status end,
      failure_count = case when failure_count < 2147483647 then failure_count + 1 else failure_count end,
      last_error_code = $2,
      invalidated_at = case when $3 then now() else invalidated_at end,
      updated_at = now()
      where id = $1 and status = $4`, [id, safeCode, Boolean(invalid), ACTIVE]);
  }

  async function recordDeliverySuccess(id) {
    await query(`update user_push_devices set failure_count = 0, last_error_code = null,
      last_seen_at = now(), updated_at = now() where id = $1 and status = $2`, [id, ACTIVE]);
  }

  async function sendPushMessage({ userIds = [], route = DEFAULT_ROUTE } = {}) {
    const users = normalizeUserIds(userIds);
    if (!users.length || !isConfigured()) return { attempted: 0, delivered: 0, skipped: true };

    let bearer;
    try {
      bearer = await getAccessToken();
    } catch (_) {
      return { attempted: 0, delivered: 0, skipped: true };
    }

    let selected;
    try {
      selected = await query(`select id, token_ciphertext from user_push_devices
        where user_id = any($1::uuid[]) and platform = 'android' and status = $2
        order by updated_at desc limit ${MAX_DEVICES}`, [users, ACTIVE]);
    } catch (_) {
      return { attempted: 0, delivered: 0, skipped: true };
    }
    const devices = (Array.isArray(selected) ? selected : [])
      .slice(0, MAX_DEVICES)
      .filter((device) => normalizeUuid(device?.id));
    const safeRoute = normalizeRoute(route);
    let delivered = 0;

    await runWithConcurrency(devices, 10, async (device) => {
      const deviceId = normalizeUuid(device.id);
      let registrationToken;
      try {
        registrationToken = decryptToken(device.token_ciphertext);
        if (!validDeviceToken(registrationToken)) throw new Error('Encrypted push token is invalid.');
      } catch (_) {
        await recordDeliveryFailure(deviceId, 'token_decryption_failed', true).catch(() => {});
        return;
      }

      let currentBearer = bearer;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        let body;
        try {
          ({ response, body } = await requestJson(`${FCM_SEND_BASE_URL}/${encodeURIComponent(account.projectId)}/messages:send`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${currentBearer}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              message: {
                token: registrationToken,
                notification: { title: '新消息提醒', body: '您收到一条新消息' },
                data: { route: safeRoute },
                android: {
                  priority: 'high',
                  notification: { channel_id: 'messages', visibility: 'private' }
                }
              }
            })
          }));
        } catch (_) {
          await recordDeliveryFailure(deviceId, 'transport_error').catch(() => {});
          return;
        }

        if (response?.ok) {
          delivered += 1;
          await recordDeliverySuccess(deviceId).catch(() => {});
          return;
        }

        const failure = deliveryFailure(Number(response?.status) || 0, body);
        if (failure.authorization && attempt === 0) {
          try {
            currentBearer = await getAccessToken(currentBearer);
            continue;
          } catch (_) {
            await recordDeliveryFailure(deviceId, 'authorization_failed').catch(() => {});
            return;
          }
        }
        await recordDeliveryFailure(deviceId, failure.code, failure.invalid).catch(() => {});
        return;
      }
    });

    return { attempted: devices.length, delivered, skipped: false };
  }

  return { getMyPushStatus, isConfigured, registerPushDevice, sendPushMessage, unregisterPushDevice };
}

module.exports = { createFcmPushService };

const { URLSearchParams } = require('node:url');

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ACTIVE = 'active';

function base64url(value) { return Buffer.from(value).toString('base64url'); }
function deliveryCode(payload) {
  const error = payload?.error || payload || {};
  const details = Array.isArray(error.details) ? error.details : [];
  const fcmTokenInvalid = details.some((detail) =>
    String(detail?.['@type'] || '').includes('google.firebase.fcm.v1.FcmError') && detail?.errorCode === 'INVALID_ARGUMENT'
  );
  if (error.status === 'UNREGISTERED' || details.some((detail) => detail?.errorCode === 'UNREGISTERED')) return 'unregistered';
  if (fcmTokenInvalid) return 'invalid';
  return 'delivery_failed';
}

function timeoutSignal(milliseconds) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(milliseconds)
    : undefined;
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

function createFcmPushService({ crypto, tokenSecret, fcmServiceAccountJson = '', fetchImpl = globalThis.fetch, query, requireUser, ok, fail, uuid }) {
  let accessToken = null;
  let accessTokenExpiresAt = 0;

  function serviceAccount() {
    const raw = String(fcmServiceAccountJson || '').trim();
    if (!raw) return null;
    try {
      const account = JSON.parse(raw);
      return account?.client_email && account?.private_key && account?.project_id ? account : null;
    } catch (_) { return null; }
  }
  function tokenHash(value) { return crypto.createHmac('sha256', String(tokenSecret || 'fcm-device-token')).update(String(value)).digest('hex'); }
  function encryptionKey() { return crypto.createHash('sha256').update(`fcm-device-token:${tokenSecret}`).digest(); }
  function encryptToken(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
  }
  function decryptToken(value) {
    const [version, iv, tag, body] = String(value || '').split('.');
    if (version !== 'v1' || !iv || !tag || !body) throw new Error('Invalid encrypted push device token.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }
  function isConfigured() { return Boolean(serviceAccount() && typeof fetchImpl === 'function'); }

  async function getAccessToken(account) {
    if (accessToken && accessTokenExpiresAt > Date.now() + 60_000) return accessToken;
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({ iss: account.client_email, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600 }));
    const input = `${header}.${claims}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(input);
    signer.end();
    const assertion = `${input}.${signer.sign(account.private_key).toString('base64url')}`;
    const response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
        signal: timeoutSignal(10_000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new Error('FCM authorization failed.');
    accessToken = String(body.access_token);
    accessTokenExpiresAt = Date.now() + Math.max(60, Number(body.expires_in || 3600) - 60) * 1000;
    return accessToken;
  }

  async function registerPushDevice(payload = {}, auth) {
    const user = await requireUser(auth);
    const token = String(payload.token || '').trim();
    const platform = String(payload.platform || 'android').trim().toLowerCase();
    if (token.length < 32 || token.length > 4096 || /[\u0000-\u001F\u007F]/.test(token)) return fail('Invalid push device token.', 400, 2001);
    if (platform !== 'android') return fail('Only Android push devices are supported.', 400, 2001);
    await query(`
      insert into user_push_devices (id, user_id, platform, token_hash, token_ciphertext, status, last_seen_at, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,now(),now(),now())
      on conflict (token_hash) do update set user_id = excluded.user_id, platform = excluded.platform,
        token_ciphertext = excluded.token_ciphertext, status = $6, failure_count = 0, last_error_code = null,
        last_seen_at = now(), invalidated_at = null, updated_at = now()
    `, [uuid(), user.id, platform, tokenHash(token), encryptToken(token), ACTIVE]);
    return ok({ registered: true, platform });
  }

  async function unregisterPushDevice(payload = {}, auth) {
    const user = await requireUser(auth);
    const token = String(payload.token || '').trim();
    if (token.length < 32 || token.length > 4096 || /[\u0000-\u001F\u007F]/.test(token)) return fail('Invalid push device token.', 400, 2001);
    await query(`update user_push_devices set status = 'revoked', invalidated_at = now(), updated_at = now()
      where user_id = $1 and token_hash = $2 and status = $3`, [user.id, tokenHash(token), ACTIVE]);
    return ok({ revoked: true });
  }

  async function getMyPushStatus(_params = {}, auth) {
    const user = await requireUser(auth);
    const rows = await query(`select count(*) filter (where status = $2)::int as active_device_count from user_push_devices where user_id = $1`, [user.id, ACTIVE]);
    return ok({ configured: isConfigured(), active_device_count: Number(rows[0]?.active_device_count || 0) });
  }
  async function disableDevice(id, code, invalid = false) {
    await query(`update user_push_devices set status = case when $3 then 'invalid' else status end, failure_count = failure_count + 1,
      last_error_code = $2, invalidated_at = case when $3 then now() else invalidated_at end, updated_at = now() where id = $1`, [id, code, invalid]);
  }

  async function sendPushMessage({ userIds = [], route = '/chat' } = {}) {
    const users = [...new Set((Array.isArray(userIds) ? userIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!users.length || !isConfigured()) return { attempted: 0, delivered: 0, skipped: true };
    const account = serviceAccount();
    let bearer;
    try { bearer = await getAccessToken(account); } catch (_) { return { attempted: 0, delivered: 0, skipped: true }; }
    const devices = await query(`select id, token_ciphertext from user_push_devices
      where user_id = any($1::uuid[]) and platform = 'android' and status = $2 order by updated_at desc limit 500`, [users, ACTIVE]);
    let delivered = 0;
    await runWithConcurrency(devices || [], 10, async (device) => {
      let registrationToken;
      try { registrationToken = decryptToken(device.token_ciphertext); } catch (_) { await disableDevice(device.id, 'token_decryption_failed', true).catch(() => {}); return; }
      try {
        const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
          method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message: { token: registrationToken, notification: { title: '新消息提醒', body: '您收到一条新消息' },
            data: { route: String(route || '/chat').slice(0, 100) }, android: { priority: 'high', notification: { channel_id: 'messages', visibility: 'private' } } } }),
          signal: timeoutSignal(10_000)
        });
        if (response.ok) { delivered += 1; return; }
        const code = deliveryCode(await response.json().catch(() => ({})));
        await disableDevice(device.id, code, code === 'unregistered' || code === 'invalid').catch(() => {});
      } catch (_) { await disableDevice(device.id, 'transport_error').catch(() => {}); }
    });
    return { attempted: devices.length, delivered, skipped: false };
  }

  return { getMyPushStatus, isConfigured, registerPushDevice, sendPushMessage, unregisterPushDevice };
}

module.exports = { createFcmPushService };

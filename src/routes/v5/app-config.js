const crypto = require('crypto');
const { isIP } = require('net');
const QRCode = require('qrcode');
const { express, z, validate, wrapV5, AppError } = require('./helpers');

const PAIRING_VERSION = '2';
const PAIRING_APP_LINK_PATH = '/api/v5/app-pairing/link';
const PAIRING_UNAVAILABLE_REASON = 'App pairing requires an HTTPS hostname on standard port 443.';
const MAX_PAIRING_NONCES = 2048;
const DOWNLOAD_PAGE_PAIRING_SCRIPT = `
(() => {
  'use strict';
  const pairing = document.getElementById('pairing');
  const qr = document.getElementById('pairing-qr');
  const apkDownload = document.getElementById('apk-download');
  const unavailable = document.getElementById('pairing-unavailable');
  const fallbackMessage = '当前服务器不支持扫码配对。请配置 HTTPS 域名并使用标准 443 端口后刷新本页面。';

  const showUnavailable = (message) => {
    pairing.hidden = true;
    unavailable.textContent = typeof message === 'string' && message.trim() ? message : fallbackMessage;
    unavailable.hidden = false;
  };

  window.fetch('/api/v5/app-config', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  })
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('config')))
    .then((payload) => {
      const config = payload && payload.data;
      if (apkDownload && config && typeof config.apk_download_url === 'string') {
        try {
          const apkUrl = new URL(config.apk_download_url);
          if ((apkUrl.protocol === 'http:' || apkUrl.protocol === 'https:') && !apkUrl.username && !apkUrl.password) {
            apkDownload.href = apkUrl.href;
          }
        } catch (_) {
          apkDownload.href = '/download/app.apk';
        }
      }
      if (!config || config.pairing_available !== true) {
        showUnavailable(config && config.pairing_unavailable_reason);
        return;
      }
      qr.src = '/api/v5/app-pairing/qr.svg';
      pairing.hidden = false;
    })
    .catch(() => showUnavailable(fallbackMessage));
})();
`;

function canonicalOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

function requestOrigin(req, config) {
  const configured = canonicalOrigin(config.appPublicUrl);
  if (configured) return configured;
  const host = String(req.get('host') || '').trim();
  if (!host || /[\s\\/]/.test(host)) return '';
  return canonicalOrigin(`${req.protocol}://${host}`);
}

function publicHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function pairingSecret(config) {
  const raw = String(config.appPairingSecret || '');
  const secret = raw.trim();
  if (raw !== secret || secret.length < 32
    || /^(change-me-please|your-long-random-secret|generated-by-installer)$/i.test(secret)
    || /^(.)\1+$/.test(secret)) return '';
  return secret;
}

function pairingTtlMinutes(config) {
  const value = Number(config.appPairingTtlMinutes);
  return Number.isFinite(value) ? Math.max(1, Math.min(60, Math.floor(value))) : 10;
}

function isPairingOriginAllowed(origin) {
  try {
    const url = new URL(origin);
    const hostname = String(url.hostname || '').replace(/^\[|\]$/g, '');
    return url.protocol === 'https:' && !url.port && isIP(hostname) === 0;
  } catch (_) {
    return false;
  }
}

function pairingAvailability(origin, hasPairingSecret) {
  if (isPairingOriginAllowed(origin) && hasPairingSecret) {
    return { available: true, reason: null };
  }
  return { available: false, reason: PAIRING_UNAVAILABLE_REASON };
}

function pairingUnavailableError() {
  return new AppError(PAIRING_UNAVAILABLE_REASON, { status: 503, code: 5000 });
}

function ensurePairingAvailable(appConfig) {
  if (!appConfig.pairing_available) throw pairingUnavailableError();
}

function safeIdentityLabel(value, fallback) {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.length > 160
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(candidate)) {
    return String(fallback || '').trim().slice(0, 160) || 'Laboratory Management System';
  }
  return candidate;
}

function safeInstanceId(value) {
  const candidate = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(candidate) ? candidate : '';
}

function buildInstanceIdentity(origin, config) {
  const appName = safeIdentityLabel(config.appName, 'Laboratory Management System');
  const organizationName = safeIdentityLabel(
    config.appOrganizationName || process.env.APP_ORGANIZATION_NAME,
    appName
  );
  const instanceName = safeIdentityLabel(
    config.appInstanceName || process.env.APP_INSTANCE_NAME,
    'Primary Server'
  );
  const secret = pairingSecret(config);
  const configuredInstanceId = safeInstanceId(config.appInstanceId || process.env.APP_INSTANCE_ID);
  const instanceId = configuredInstanceId || `inst_${crypto.createHmac('sha256', secret || origin)
    .update(`laboratory-instance-id-v1|${origin}`, 'utf8')
    .digest('base64url')
    .slice(0, 26)}`;
  const fingerprint = (secret
    ? crypto.createHmac('sha256', secret)
      .update(`laboratory-instance-fingerprint-v1|${origin}|${instanceId}`, 'utf8')
    : crypto.createHash('sha256')
      .update(`unpaired-instance-fingerprint-v1|${origin}|${instanceId}|${organizationName}|${instanceName}`, 'utf8'))
    .digest('hex');
  return {
    organization_name: organizationName,
    instance_name: instanceName,
    instance_id: instanceId,
    instance_fingerprint: fingerprint
  };
}

function createProof({ origin, expiresAt, nonce, secret }) {
  return crypto.createHmac('sha256', secret)
    .update(`${PAIRING_VERSION}|${origin}|${expiresAt}|${nonce}`, 'utf8')
    .digest('base64url');
}

function proofMatches(expected, received) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(received || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function encodePairingToken({ expiresAt, nonce, proof }) {
  return Buffer.from(JSON.stringify({ e: expiresAt, n: nonce, p: proof }), 'utf8').toString('base64url');
}

function decodePairingToken(token) {
  try {
    const parsed = JSON.parse(Buffer.from(String(token || ''), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.e !== 'string' || typeof parsed.n !== 'string' || typeof parsed.p !== 'string'
      || !/^[A-Za-z0-9_-]{32,128}$/.test(parsed.n)) return null;
    return { expiresAt: parsed.e, nonce: parsed.n, proof: parsed.p };
  } catch (_) {
    return null;
  }
}

function createPairingNonceStore() {
  const nonces = new Map();

  function cleanup(now = Date.now()) {
    for (const [nonce, record] of nonces) {
      if (record.expiresAtMs <= now) nonces.delete(nonce);
    }
    while (nonces.size >= MAX_PAIRING_NONCES) {
      const oldest = nonces.keys().next().value;
      if (!oldest) break;
      nonces.delete(oldest);
    }
  }

  return {
    issue({ nonce, origin, expiresAtMs }) {
      cleanup();
      nonces.set(nonce, { origin, expiresAtMs, consumedAt: 0, installationHash: '' });
    },
    isUsable({ nonce, origin, expiresAtMs }) {
      cleanup();
      const record = nonces.get(nonce);
      return Boolean(record && !record.consumedAt && record.origin === origin && record.expiresAtMs === expiresAtMs);
    },
    consume({ nonce, origin, expiresAtMs, installationId, secret }) {
      cleanup();
      const record = nonces.get(nonce);
      if (!record || record.consumedAt || record.origin !== origin || record.expiresAtMs !== expiresAtMs) return false;
      record.consumedAt = Date.now();
      record.installationHash = crypto.createHmac('sha256', secret)
        .update(`pairing-installation-v1|${installationId}`, 'utf8')
        .digest('hex');
      return true;
    }
  };
}

const defaultPairingNonceStore = createPairingNonceStore();

function buildAppConfig(req, config) {
  const origin = requestOrigin(req, config);
  if (!origin) throw new AppError('A public server URL is required for app pairing.', { status: 503, code: 5000 });
  const pairing = pairingAvailability(origin, Boolean(pairingSecret(config)));
  return {
    app_name: safeIdentityLabel(config.appName, 'Laboratory Management System'),
    server_url: origin,
    web_url: `${origin}/v5/`,
    api_base_url: `${origin}/api/v5`,
    download_url: `${origin}/download`,
    apk_download_url: publicHttpUrl(config.apkDownloadUrl) || `${origin}/download/app.apk`,
    pairing_scheme: 'labapp://pair',
    pairing_app_link_path: PAIRING_APP_LINK_PATH,
    pairing_available: pairing.available,
    pairing_unavailable_reason: pairing.reason,
    ...buildInstanceIdentity(origin, config)
  };
}

function buildPairing(req, config, nonceStore = defaultPairingNonceStore) {
  const appConfig = buildAppConfig(req, config);
  ensurePairingAvailable(appConfig);
  const secret = pairingSecret(config);
  if (!secret) throw new AppError('App pairing is not configured.', { status: 503, code: 5000 });
  const expiresAt = new Date(Date.now() + pairingTtlMinutes(config) * 60_000).toISOString();
  const expiresAtMs = new Date(expiresAt).getTime();
  const nonce = crypto.randomBytes(24).toString('base64url');
  const proof = createProof({ origin: appConfig.server_url, expiresAt, nonce, secret });
  const token = encodePairingToken({ expiresAt, nonce, proof });
  nonceStore.issue({ nonce, origin: appConfig.server_url, expiresAtMs });
  const params = new URLSearchParams({ v: PAIRING_VERSION, server: appConfig.server_url, token });
  return {
    version: PAIRING_VERSION,
    server_url: appConfig.server_url,
    expires_at: expiresAt,
    pairing_uri: `${appConfig.server_url}${PAIRING_APP_LINK_PATH}?${params.toString()}`,
    fallback_pairing_uri: `labapp://pair?${params.toString()}`,
    organization_name: appConfig.organization_name,
    instance_name: appConfig.instance_name,
    instance_id: appConfig.instance_id,
    instance_fingerprint: appConfig.instance_fingerprint
  };
}

function validatePairingToken({ pairingOrigin, rawToken, appConfig, config, nonceStore, consume, installationId }) {
  const token = decodePairingToken(rawToken);
  const expiresAt = token ? new Date(token.expiresAt) : null;
  const expiresAtMs = expiresAt ? expiresAt.getTime() : NaN;
  if (!token || !expiresAt || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new AppError('The pairing QR code has expired or is invalid.', { status: 400, code: 2002 });
  }
  const secret = pairingSecret(config);
  const expected = createProof({
    origin: pairingOrigin,
    expiresAt: expiresAt.toISOString(),
    nonce: token.nonce,
    secret
  });
  if (!proofMatches(expected, token.proof)) {
    throw new AppError('The pairing QR code is invalid.', { status: 400, code: 2002 });
  }
  const nonceInput = { nonce: token.nonce, origin: appConfig.server_url, expiresAtMs };
  const accepted = consume
    ? nonceStore.consume({ ...nonceInput, installationId, secret })
    : nonceStore.isUsable(nonceInput);
  if (!accepted) {
    throw new AppError('The pairing QR code has already been used or is no longer valid.', { status: 400, code: 2002 });
  }
  return token;
}

function singleQueryValue(value) {
  return typeof value === 'string' ? value : '';
}

function createV5AppConfigRouter(config) {
  const router = express.Router();
  const nonceStore = createPairingNonceStore();
  router.get('/app-config/download-page.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.type('application/javascript').send(DOWNLOAD_PAGE_PAIRING_SCRIPT);
  });
  router.get('/app-config', wrapV5(async (req) => buildAppConfig(req, config)));
  router.get('/app-pairing', wrapV5(async (req) => buildPairing(req, config, nonceStore)));
  router.get('/app-pairing/qr.svg', async (req, res, next) => {
    try {
      const pairing = buildPairing(req, config, nonceStore);
      const svg = await QRCode.toString(pairing.pairing_uri, {
        type: 'svg', width: 256, margin: 1, errorCorrectionLevel: 'M'
      });
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.type('image/svg+xml').send(svg);
    } catch (error) {
      next(error);
    }
  });
  router.get('/app-pairing/link', (req, res, next) => {
    try {
      const payload = {
        v: singleQueryValue(req.query.v),
        server: singleQueryValue(req.query.server),
        token: singleQueryValue(req.query.token)
      };
      if (payload.v !== PAIRING_VERSION || Object.keys(req.query).some((key) => !['v', 'server', 'token'].includes(key))) {
        throw new AppError('Unsupported or malformed pairing link.', { status: 400, code: 2002 });
      }
      const appConfig = buildAppConfig(req, config);
      ensurePairingAvailable(appConfig);
      const pairingOrigin = canonicalOrigin(payload.server);
      if (!pairingOrigin || pairingOrigin !== appConfig.server_url) {
        throw new AppError('The pairing QR code belongs to another server.', { status: 400, code: 2002 });
      }
      validatePairingToken({
        pairingOrigin,
        rawToken: payload.token,
        appConfig,
        config,
        nonceStore,
        consume: false,
        installationId: ''
      });
      const params = new URLSearchParams({ v: PAIRING_VERSION, server: pairingOrigin, token: payload.token });
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.redirect(302, `labapp://pair?${params.toString()}`);
    } catch (error) {
      next(error);
    }
  });
  router.post('/app-pairing/exchange', validate({ body: z.object({
    v: z.literal(PAIRING_VERSION),
    server: z.string().min(1).max(2048),
    token: z.string().min(16).max(2048),
    installation_id: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/)
  }).strict() }), wrapV5(async (req) => {
    const secret = pairingSecret(config);
    if (!secret) throw new AppError('App pairing is not configured.', { status: 503, code: 5000 });
    const payload = req.validated.body;
    const appConfig = buildAppConfig(req, config);
    ensurePairingAvailable(appConfig);
    const pairingOrigin = canonicalOrigin(payload.server);
    if (!pairingOrigin || pairingOrigin !== appConfig.server_url) {
      throw new AppError('The pairing QR code belongs to another server.', { status: 400, code: 2002 });
    }
    validatePairingToken({
      pairingOrigin,
      rawToken: payload.token,
      appConfig,
      config,
      nonceStore,
      consume: true,
      installationId: payload.installation_id
    });
    return appConfig;
  }));
  return router;
}

module.exports = { buildAppConfig, buildPairing, createV5AppConfigRouter };
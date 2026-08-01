const crypto = require('crypto');
const { isIP } = require('net');
const QRCode = require('qrcode');
const { express, z, validate, wrapV5, AppError } = require('./helpers');

const PAIRING_VERSION = '1';
const PAIRING_UNAVAILABLE_REASON = 'App pairing requires an HTTPS hostname on standard port 443.';
const DOWNLOAD_PAGE_PAIRING_SCRIPT = `
(() => {
  'use strict';
  const pairing = document.getElementById('pairing');
  const qr = document.getElementById('pairing-qr');
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
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
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

function pairingSecret(config) {
  const secret = String(config.appPairingSecret || '').trim();
  if (secret.length < 32 || /^(change-me-please|your-long-random-secret|generated-by-installer)$/i.test(secret)) return '';
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

function createProof({ origin, expiresAt, secret }) {
  return crypto.createHmac('sha256', secret)
    .update(`${PAIRING_VERSION}|${origin}|${expiresAt}`, 'utf8')
    .digest('base64url');
}

function proofMatches(expected, received) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(received || ''), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function encodePairingToken({ expiresAt, proof }) {
  return Buffer.from(JSON.stringify({ e: expiresAt, p: proof }), 'utf8').toString('base64url');
}

function decodePairingToken(token) {
  try {
    const parsed = JSON.parse(Buffer.from(String(token || ''), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.e !== 'string' || typeof parsed.p !== 'string') return null;
    return { expiresAt: parsed.e, proof: parsed.p };
  } catch (_) {
    return null;
  }
}

function buildAppConfig(req, config) {
  const origin = requestOrigin(req, config);
  if (!origin) throw new AppError('A public server URL is required for app pairing.', { status: 503, code: 5000 });
  const pairing = pairingAvailability(origin, Boolean(pairingSecret(config)));
  return {
    app_name: String(config.appName || 'Laboratory Management System'),
    server_url: origin,
    web_url: `${origin}/v5/`,
    api_base_url: `${origin}/api/v5`,
    download_url: `${origin}/download`,
    apk_download_url: String(config.apkDownloadUrl || `${origin}/download/app.apk`),
    pairing_scheme: 'labapp://pair',
    pairing_available: pairing.available,
    pairing_unavailable_reason: pairing.reason
  };
}

function buildPairing(req, config) {
  const appConfig = buildAppConfig(req, config);
  ensurePairingAvailable(appConfig);
  const secret = pairingSecret(config);
  if (!secret) throw new AppError('App pairing is not configured.', { status: 503, code: 5000 });
  const expiresAt = new Date(Date.now() + pairingTtlMinutes(config) * 60_000).toISOString();
  const proof = createProof({ origin: appConfig.server_url, expiresAt, secret });
  const token = encodePairingToken({ expiresAt, proof });
  const params = new URLSearchParams({ v: PAIRING_VERSION, server: appConfig.server_url, token });
  return {
    version: PAIRING_VERSION,
    server_url: appConfig.server_url,
    expires_at: expiresAt,
    pairing_uri: `labapp://pair?${params.toString()}`
  };
}

function createV5AppConfigRouter(config) {
  const router = express.Router();
  router.get('/app-config/download-page.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.type('application/javascript').send(DOWNLOAD_PAGE_PAIRING_SCRIPT);
  });
  router.get('/app-config', wrapV5(async (req) => buildAppConfig(req, config)));
  router.get('/app-pairing', wrapV5(async (req) => buildPairing(req, config)));
  router.get('/app-pairing/qr.svg', async (req, res, next) => {
    try {
      const pairing = buildPairing(req, config);
      const svg = await QRCode.toString(pairing.pairing_uri, {
        type: 'svg', width: 256, margin: 1, errorCorrectionLevel: 'M'
      });
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.type('image/svg+xml').send(svg);
    } catch (error) {
      next(error);
    }
  });
  router.post('/app-pairing/exchange', validate({ body: z.object({
    v: z.string().optional(),
    server: z.string().min(1).max(2048),
    token: z.string().min(16).max(2048)
  }) }), wrapV5(async (req) => {
    const secret = pairingSecret(config);
    if (!secret) throw new AppError('App pairing is not configured.', { status: 503, code: 5000 });
    const payload = req.validated.body;
    if (payload.v && payload.v !== PAIRING_VERSION) {
      throw new AppError('Unsupported pairing version.', { status: 400, code: 2002 });
    }
    const appConfig = buildAppConfig(req, config);
    ensurePairingAvailable(appConfig);
    const pairingOrigin = canonicalOrigin(payload.server);
    if (!pairingOrigin || pairingOrigin !== appConfig.server_url) {
      throw new AppError('The pairing QR code belongs to another server.', { status: 400, code: 2002 });
    }
    const token = decodePairingToken(payload.token);
    const expiresAt = token ? new Date(token.expiresAt) : null;
    if (!token || !expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new AppError('The pairing QR code has expired or is invalid.', { status: 400, code: 2002 });
    }
    const expected = createProof({ origin: pairingOrigin, expiresAt: expiresAt.toISOString(), secret });
    if (!proofMatches(expected, token.proof)) {
      throw new AppError('The pairing QR code is invalid.', { status: 400, code: 2002 });
    }
    return appConfig;
  }));
  return router;
}

module.exports = { buildAppConfig, buildPairing, createV5AppConfigRouter };

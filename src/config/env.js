const path = require('path');
const crypto = require('crypto');
const { isIP } = require('net');

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || 'false').toLowerCase());
}

function resolveStorageDir(value, rootDir, fallbackName) {
  const configured = String(value || '').trim();
  if (!configured) return path.join(rootDir, fallbackName);
  // Local Windows preview falls back from a Linux deployment path.
  if (process.platform === 'win32' && /^\/(?:opt|var)\//i.test(configured.replace(/\\/g, '/'))) {
    return path.join(rootDir, fallbackName);
  }
  return path.resolve(rootDir, configured);
}

function validateFirebaseServiceAccount(raw) {
  const account = JSON.parse(raw);
  if (!account || account.type !== 'service_account'
    || typeof account.project_id !== 'string' || !account.project_id.trim()
    || typeof account.client_email !== 'string' || !account.client_email.trim()
    || typeof account.private_key !== 'string' || !account.private_key.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Firebase service-account JSON is missing required fields.');
  }
  crypto.createPrivateKey(account.private_key);
  return raw;
}

function decodeFirebaseServiceAccount(env) {
  const encoded = String(env.FCM_SERVICE_ACCOUNT_JSON_BASE64 || '').trim();
  if (encoded) {
    try {
      if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error('Firebase service-account Base64 is malformed.');
      }
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      if (Buffer.from(decoded, 'utf8').toString('base64') !== encoded) {
        throw new Error('Firebase service-account Base64 is not canonical.');
      }
      return { value: validateFirebaseServiceAccount(decoded), error: '' };
    } catch (_) {
      // A valid legacy value keeps an existing deployment working during rotation.
    }
  }
  const legacy = String(env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (legacy) {
    try {
      return { value: validateFirebaseServiceAccount(legacy), error: '' };
    } catch (_) {
      return { value: '', error: 'Firebase FCM service-account configuration is invalid.' };
    }
  }
  return encoded
    ? { value: '', error: 'Firebase FCM service-account configuration is invalid.' }
    : { value: '', error: '' };
}

function loadConfig(env = process.env) {
  const rootDir = path.resolve(__dirname, '..', '..');
  const firebaseServiceAccount = decodeFirebaseServiceAccount(env);
  const uploadDir = resolveStorageDir(env.UPLOAD_DIR, rootDir, 'uploads');
  const exportDir = String(env.EXPORT_DIR || '').trim()
    ? resolveStorageDir(env.EXPORT_DIR, rootDir, 'exports')
    : path.join(uploadDir, 'exports');
  return {
    nodeEnv: env.NODE_ENV || 'development',
    rootDir,
    publicDir: path.join(rootDir, 'public'),
    host: String(env.HOST || '127.0.0.1').trim(),
    port: Number(env.PORT || 3000),
    adminPassword: env.ADMIN_PASSWORD || '',
    tokenSecret: env.TOKEN_SECRET || 'change-me-please',
    appName: env.APP_NAME || 'Laboratory Management System',
    appPublicUrl: env.APP_PUBLIC_URL || '',
    appPairingSecret: env.APP_PAIRING_SECRET || '',
    appPairingTtlMinutes: Number(env.APP_PAIRING_TTL_MINUTES || 10),
    apkDownloadUrl: env.APK_DOWNLOAD_URL || '',
    wechatToken: env.WECHAT_TOKEN || '',
    wechatAppId: env.WECHAT_APP_ID || '',
    wechatAppSecret: env.WECHAT_APP_SECRET || '',
    wechatAdminOpenids: env.WECHAT_ADMIN_OPENIDS || '',
    // Base64 avoids newline/escaping damage in .env files. Raw JSON remains supported for compatibility.
    // Never log or commit either value.
    fcmServiceAccountJson: firebaseServiceAccount.value,
    fcmServiceAccountError: firebaseServiceAccount.error,
    uploadDir,
    exportDir,
    exportRetentionDays: Number(env.EXPORT_RETENTION_DAYS || 30),
    databaseUrl: env.DATABASE_URL || '',
    pgssl: parseBoolean(env.PGSSL),
    pgsslRejectUnauthorized: String(env.PGSSL_REJECT_UNAUTHORIZED ?? 'true').toLowerCase() !== 'false',
    // An unset value permits only same-origin requests. Production must declare explicit origins.
    corsOrigin: Object.prototype.hasOwnProperty.call(env, 'CORS_ORIGIN') ? String(env.CORS_ORIGIN || '').trim() : '',
    trustProxy: parseBoolean(env.TRUST_PROXY),
    authRateLimitMax: Number(env.AUTH_RATE_LIMIT_MAX || 10),
    authRateLimitWindowMs: Number(env.AUTH_RATE_LIMIT_WINDOW_MS || 10 * 60_000),
    apiRateLimitMax: Number(env.API_RATE_LIMIT_MAX || 120),
    apiRateLimitWindowMs: Number(env.API_RATE_LIMIT_WINDOW_MS || 60_000),
    enableSchedulers: String(env.ENABLE_SCHEDULERS ?? 'true').toLowerCase() !== 'false'
  };
}

function corsOriginList(config) {
  if (config.corsOrigin === '*') return true;
  return String(config.corsOrigin || '').split(',').map((item) => item.trim()).filter(Boolean).map((origin) => {
    try { return new URL(origin).origin; } catch (_) { return origin; }
  });
}

function isPlaceholderSecret(value) {
  const secret = String(value || '');
  return !secret
    || secret.trim() !== secret
    || /^(change-me-please|your-long-random-secret|generated-by-installer)$/i.test(secret)
    || /^(.)\1+$/.test(secret);
}

function isWeakAdminPassword(value) {
  const password = String(value || '');
  return password.length < 12
    || /^(change-me|your-admin-password|generated-by-installer|123456|admin|password)$/i.test(password)
    || /^(.)\1+$/.test(password);
}

function isValidHttpOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password
      && (url.pathname === '/' || url.pathname === '')
      && !url.search && !url.hash;
  } catch (_) {
    return false;
  }
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch (_) {
    return false;
  }
}

function isSecureAppPairingOrigin(value) {
  if (!isValidHttpOrigin(value)) return false;
  try {
    const url = new URL(String(value || ''));
    const hostname = String(url.hostname || '').replace(/^\[|\]$/g, '');
    return url.protocol === 'https:' && !url.port && isIP(hostname) === 0;
  } catch (_) {
    return false;
  }
}

function buildRuntimeStatus(config) {
  const warnings = [];
  const errors = [];
  const isProduction = String(config.nodeEnv || '').toLowerCase() === 'production';
  const push = (message, fatalInProduction = false) => (isProduction && fatalInProduction ? errors : warnings).push(message);

  if (!config.adminPassword) push('ADMIN_PASSWORD is not configured.', true);
  else if (isWeakAdminPassword(config.adminPassword)) push('ADMIN_PASSWORD is weak or still a placeholder.', true);
  if (!config.tokenSecret || isPlaceholderSecret(config.tokenSecret)) push('TOKEN_SECRET is missing or still a placeholder.', true);
  else if (String(config.tokenSecret).length < 32) push('TOKEN_SECRET must be at least 32 characters.', true);
  if (config.appPublicUrl && !isValidHttpOrigin(config.appPublicUrl)) {
    push('APP_PUBLIC_URL must be an absolute HTTP(S) origin without paths or credentials.', true);
  }
  if (config.apkDownloadUrl && !isValidHttpUrl(config.apkDownloadUrl)) {
    push('APK_DOWNLOAD_URL must be an absolute HTTP(S) URL without credentials.', true);
  }
  const appPairingTtlMinutes = Number(config.appPairingTtlMinutes ?? 10);
  if (!Number.isInteger(appPairingTtlMinutes) || appPairingTtlMinutes < 1 || appPairingTtlMinutes > 60) {
    push('APP_PAIRING_TTL_MINUTES must be an integer from 1 to 60.', true);
  }
  if (isSecureAppPairingOrigin(config.appPublicUrl)
    && (!config.appPairingSecret || isPlaceholderSecret(config.appPairingSecret) || String(config.appPairingSecret).length < 32)) {
    push('APP_PAIRING_SECRET must be a non-placeholder secret of at least 32 characters when HTTPS app pairing is enabled.', true);
  }
  if (config.corsOrigin === '*') push('CORS_ORIGIN allows every origin; configure approved origins only.', true);
  else {
    const origins = String(config.corsOrigin || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!origins.length || origins.some((origin) => !isValidHttpOrigin(origin))) {
      push('CORS_ORIGIN must be one or more absolute HTTP(S) origins without paths or credentials.', true);
    }
  }
  if (Object.prototype.hasOwnProperty.call(config, 'host')) {
    if (!config.host) push('HOST must not be empty.', true);
    else if (['0.0.0.0', '::', '[::]'].includes(config.host)) {
      push('HOST exposes the Node service directly; use 127.0.0.1 behind Nginx.', true);
    }
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) push('PORT must be an integer from 1 to 65535.', true);
  if (!Number.isFinite(config.authRateLimitMax) || config.authRateLimitMax < 1) push('AUTH_RATE_LIMIT_MAX must be positive.', true);
  if (!Number.isFinite(config.authRateLimitWindowMs) || config.authRateLimitWindowMs < 1000) push('AUTH_RATE_LIMIT_WINDOW_MS must be at least 1000.', true);
  if (!Number.isFinite(config.apiRateLimitMax) || config.apiRateLimitMax < 1) push('API_RATE_LIMIT_MAX must be positive.', true);
  if (!Number.isFinite(config.apiRateLimitWindowMs) || config.apiRateLimitWindowMs < 1000) push('API_RATE_LIMIT_WINDOW_MS must be at least 1000.', true);
  const exportRetentionDays = Number(config.exportRetentionDays ?? 30);
  if (!Number.isInteger(exportRetentionDays) || exportRetentionDays < 1 || exportRetentionDays > 3650) {
    push('EXPORT_RETENTION_DAYS must be an integer from 1 to 3650.', true);
  }
  if (config.trustProxy && !isProduction) warnings.push('TRUST_PROXY is enabled outside production; enable it only behind a trusted proxy.');
  if ((config.wechatAppId && !config.wechatAppSecret) || (!config.wechatAppId && config.wechatAppSecret)) warnings.push('WECHAT_APP_ID and WECHAT_APP_SECRET must be configured together.');
  if (config.fcmServiceAccountError) push(config.fcmServiceAccountError, true);
  if (!config.databaseUrl) push('DATABASE_URL is not configured.', true);
  if (config.pgssl && !config.pgsslRejectUnauthorized) push('PGSSL certificate verification is disabled.', true);

  return { ready: errors.length === 0 && warnings.length === 0, mode: config.databaseUrl ? 'postgres' : 'standalone', warnings, errors };
}

module.exports = { buildRuntimeStatus, corsOriginList, isPlaceholderSecret, isSecureAppPairingOrigin, isValidHttpOrigin, isValidHttpUrl, isWeakAdminPassword, loadConfig };

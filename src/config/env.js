const path = require('path');

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || 'false').toLowerCase());
}

function resolveUploadDir(value, rootDir) {
  const configured = String(value || '').trim();
  if (!configured) return path.join(rootDir, 'uploads');
  // Local Windows preview falls back from a Linux deployment path.
  if (process.platform === 'win32' && /^\/var\//i.test(configured.replace(/\\/g, '/'))) {
    return path.join(rootDir, 'uploads');
  }
  return path.resolve(rootDir, configured);
}

function loadConfig(env = process.env) {
  const rootDir = path.resolve(__dirname, '..', '..');
  return {
    nodeEnv: env.NODE_ENV || 'development',
    rootDir,
    publicDir: path.join(rootDir, 'public'),
    port: Number(env.PORT || 3000),
    adminPassword: env.ADMIN_PASSWORD || '',
    tokenSecret: env.TOKEN_SECRET || 'change-me-please',
    wechatToken: env.WECHAT_TOKEN || '',
    wechatAppId: env.WECHAT_APP_ID || '',
    wechatAppSecret: env.WECHAT_APP_SECRET || '',
    wechatAdminOpenids: env.WECHAT_ADMIN_OPENIDS || '',
    uploadDir: resolveUploadDir(env.UPLOAD_DIR, rootDir),
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
  return /^(change-me-please|your-long-random-secret|generated-by-installer)$/i.test(String(value || ''));
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

function buildRuntimeStatus(config) {
  const warnings = [];
  const errors = [];
  const isProduction = String(config.nodeEnv || '').toLowerCase() === 'production';
  const push = (message, fatalInProduction = false) => (isProduction && fatalInProduction ? errors : warnings).push(message);

  if (!config.adminPassword) push('ADMIN_PASSWORD is not configured.', true);
  else if (isWeakAdminPassword(config.adminPassword)) push('ADMIN_PASSWORD is weak or still a placeholder.', true);
  if (!config.tokenSecret || isPlaceholderSecret(config.tokenSecret)) push('TOKEN_SECRET is missing or still a placeholder.', true);
  else if (String(config.tokenSecret).length < 32) push('TOKEN_SECRET must be at least 32 characters.', true);
  if (config.corsOrigin === '*') push('CORS_ORIGIN allows every origin; configure approved origins only.', true);
  else {
    const origins = String(config.corsOrigin || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!origins.length || origins.some((origin) => !isValidHttpOrigin(origin))) {
      push('CORS_ORIGIN must be one or more absolute HTTP(S) origins without paths or credentials.', true);
    }
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) push('PORT must be an integer from 1 to 65535.', true);
  if (!Number.isFinite(config.authRateLimitMax) || config.authRateLimitMax < 1) push('AUTH_RATE_LIMIT_MAX must be positive.', true);
  if (!Number.isFinite(config.authRateLimitWindowMs) || config.authRateLimitWindowMs < 1000) push('AUTH_RATE_LIMIT_WINDOW_MS must be at least 1000.', true);
  if (!Number.isFinite(config.apiRateLimitMax) || config.apiRateLimitMax < 1) push('API_RATE_LIMIT_MAX must be positive.', true);
  if (!Number.isFinite(config.apiRateLimitWindowMs) || config.apiRateLimitWindowMs < 1000) push('API_RATE_LIMIT_WINDOW_MS must be at least 1000.', true);
  if (config.trustProxy && !isProduction) warnings.push('TRUST_PROXY is enabled outside production; enable it only behind a trusted proxy.');
  if ((config.wechatAppId && !config.wechatAppSecret) || (!config.wechatAppId && config.wechatAppSecret)) warnings.push('WECHAT_APP_ID and WECHAT_APP_SECRET must be configured together.');
  if (!config.databaseUrl) push('DATABASE_URL is not configured.', true);
  if (config.pgssl && !config.pgsslRejectUnauthorized) push('PGSSL certificate verification is disabled.', true);

  return { ready: errors.length === 0 && warnings.length === 0, mode: config.databaseUrl ? 'postgres' : 'standalone', warnings, errors };
}

module.exports = { buildRuntimeStatus, corsOriginList, isPlaceholderSecret, isValidHttpOrigin, isWeakAdminPassword, loadConfig };
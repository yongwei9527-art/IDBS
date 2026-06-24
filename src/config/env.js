const path = require('path');

function parseBoolean(value) {
  return String(value || 'false').toLowerCase() === 'true';
}

function loadConfig(env = process.env) {
  const rootDir = path.resolve(__dirname, '..', '..');

  return {
    rootDir,
    publicDir: path.join(rootDir, 'public'),
    port: Number(env.PORT || 3000),
    adminPassword: env.ADMIN_PASSWORD || '',
    tokenSecret: env.TOKEN_SECRET || 'change-me-please',
    wechatToken: env.WECHAT_TOKEN || '',
    wechatAppId: env.WECHAT_APP_ID || '',
    wechatAppSecret: env.WECHAT_APP_SECRET || '',
    wechatAdminOpenids: env.WECHAT_ADMIN_OPENIDS || '',
    uploadDir: env.UPLOAD_DIR || path.join(rootDir, 'uploads'),
    databaseUrl: env.DATABASE_URL || '',
    pgssl: parseBoolean(env.PGSSL),
    corsOrigin: env.CORS_ORIGIN || '*'
  };
}

function corsOriginList(config) {
  if (config.corsOrigin === '*') return true;
  return config.corsOrigin.split(',').map((item) => item.trim()).filter(Boolean);
}

function buildRuntimeStatus(config) {
  const warnings = [];

  if (!config.adminPassword) warnings.push('ADMIN_PASSWORD is not configured');
  if (config.adminPassword === 'change-me' || config.adminPassword === 'your-admin-password') {
    warnings.push('ADMIN_PASSWORD is still using a placeholder value');
  }
  if (!config.tokenSecret || config.tokenSecret === 'change-me-please') {
    warnings.push('TOKEN_SECRET is using the default value');
  }
  if (config.tokenSecret === 'your-long-random-secret') {
    warnings.push('TOKEN_SECRET is still using a placeholder value');
  }
  if ((config.wechatAppId && !config.wechatAppSecret) || (!config.wechatAppId && config.wechatAppSecret)) {
    warnings.push('WECHAT_APP_ID and WECHAT_APP_SECRET should be configured together');
  }
  if (!config.databaseUrl) warnings.push('DATABASE_URL is not configured');

  return {
    ready: warnings.length === 0,
    mode: config.databaseUrl ? 'postgres' : 'standalone',
    warnings
  };
}

module.exports = {
  buildRuntimeStatus,
  corsOriginList,
  loadConfig
};

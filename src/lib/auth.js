const crypto = require('crypto');
const { AppError } = require('./app-error');

/**
 * Lightweight HS256 JWT implementation used by v5 APIs.
 * V5 uses this JWT as its only API authentication credential.
 */

const DEFAULT_ACCESS_TTL_MIN = 15;
const DEFAULT_REFRESH_TTL_DAYS = 7;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function signHmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function safeSignatureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function issueJwt(payload, opts = {}) {
  const secret = opts.secret || process.env.TOKEN_SECRET || 'change-me-please';
  const type = opts.type === 'refresh' ? 'refresh' : 'access';
  const ttlSec =
    type === 'refresh'
      ? (opts.refreshTtlDays || Number(process.env.JWT_REFRESH_TTL_DAYS) || DEFAULT_REFRESH_TTL_DAYS) * 86400
      : (opts.accessTtlMin || Number(process.env.JWT_ACCESS_TTL_MINUTES) || DEFAULT_ACCESS_TTL_MIN) * 60;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    type,
    iat: now,
    exp: now + ttlSec,
    jti: crypto.randomUUID()
  };

  const encHeader = base64url(JSON.stringify(header));
  const encBody = base64url(JSON.stringify(body));
  const signingInput = `${encHeader}.${encBody}`;
  const sig = signHmac(secret, signingInput);
  return `${signingInput}.${sig}`;
}

function verifyJwt(token, opts = {}) {
  const secret = opts.secret || process.env.TOKEN_SECRET || 'change-me-please';
  const expectedType = opts.type || 'access';
  if (!token || typeof token !== 'string' || token.split('.').length !== 3) return null;

  const [encHeader, encBody, sig] = token.split('.');
  const signingInput = `${encHeader}.${encBody}`;
  if (!safeSignatureEqual(signHmac(secret, signingInput), sig)) return null;

  let header, body;
  try {
    header = JSON.parse(b64urlDecode(encHeader));
    body = JSON.parse(b64urlDecode(encBody));
  } catch (_) {
    return null;
  }
  if (header.alg !== 'HS256') return null;
  if (!body.exp || body.exp * 1000 < Date.now()) return null;
  if (expectedType && body.type !== expectedType) return null;
  return body;
}

function jwtFromReq(req) {
  const bearer = String(req?.headers?.authorization || '');
  if (bearer.startsWith('Bearer ')) return bearer.slice(7).trim();
  return '';
}

function requireAuth(req, res, next) {
  const token = jwtFromReq(req);
  const payload = verifyJwt(token, { type: 'access' });
  if (!payload) {
    return next(new AppError('未登录或登录已过期。', { status: 401, code: 1001 }));
  }
  req.auth = payload;
  req.authToken = token;
  next();
}

function optionalAuth(req, res, next) {
  const token = jwtFromReq(req);
  if (!token) {
    req.auth = null;
    return next();
  }
  const payload = verifyJwt(token, { type: 'access' });
  req.auth = payload || null;
  req.authToken = token || '';
  next();
}

function requirePerm(...required) {
  return function (req, res, next) {
    if (!req.auth) {
      return next(new AppError('未登录或登录已过期。', { status: 401, code: 1001 }));
    }
    const perms = Array.isArray(req.auth.perms) ? req.auth.perms : [];
    if (req.auth.role === 'super_admin') return next();
    const ok = perms.includes('*') || required.some((p) => perms.includes(p));
    if (!ok) {
      return next(new AppError('没有访问权限。', { status: 403, code: 1003 }));
    }
    next();
  };
}

function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.auth) {
      return next(new AppError('未登录或登录已过期。', { status: 401, code: 1001 }));
    }
    const perms = Array.isArray(req.auth.perms) ? req.auth.perms : [];
    if (req.auth.role === 'super_admin') return next();
    // v5 分权登录中，最高权限管理员也可能以 role=admin + perms=['*'] 进入；
    // 前后端统一把通配权限视为最高权限，避免系统配置等超管接口误报 403。
    if (roles.includes('super_admin') && perms.includes('*')) return next();
    if (!roles.includes(req.auth.role)) {
      return next(new AppError('没有访问权限。', { status: 403, code: 1003 }));
    }
    next();
  };
}

module.exports = {
  issueJwt,
  verifyJwt,
  jwtFromReq,
  requireAuth,
  optionalAuth,
  requirePerm,
  requireRole,
  DEFAULT_ACCESS_TTL_MIN,
  DEFAULT_REFRESH_TTL_DAYS
};

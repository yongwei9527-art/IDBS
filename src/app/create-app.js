const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { corsOriginList } = require('../config/env');
const { AppError } = require('../lib/app-error');
const { sendError } = require('../lib/http');
const { createDistributedRateLimiter, createMemoryRateLimiter, createRequestLogger, safeRequestPath } = require('../lib/security');
const { createHealthRouter } = require('../routes/health');
const { createUploadRouter } = require('../routes/upload');
const { createWechatRouter } = require('../routes/wechat');
const { createV5Router } = require('../routes/v5');
const { createWsGateway } = require('../lib/ws');

function collectInlineScriptHashes(publicDir) {
  const hashes = new Set();
  if (!fs.existsSync(publicDir)) return [];
  const entries = fs.readdirSync(publicDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.html')) continue;
    const html = fs.readFileSync(path.join(publicDir, entry.name), 'utf8');
    const scriptPattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptPattern.exec(html))) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes].sort();
}

function createSecurityHeaders(publicDir) {
  const inlineScriptHashes = collectInlineScriptHashes(publicDir);
  const csp = [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'",
    "img-src 'self' data: blob:", "media-src 'self' blob:", "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self'${inlineScriptHashes.length ? ` ${inlineScriptHashes.join(' ')}` : ''}`,
    "connect-src 'self' ws: wss:", "form-action 'self'"
  ].join('; ');
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  };
}

function isPublicPageRequest(req) {
  return req.method === 'GET' && (req.path === '/' || req.path === '/v5' || req.path.startsWith('/v5/'));
}

function isPublicApiRequest(req) {
  const pathname = req.path || '';
  return [
    '/api/v5/auth/register', '/api/v5/login/challenge', '/api/v5/login/status',
    '/api/v5/devices', '/api/v5/calendar', '/api/v5/reservation-slots', '/api/v5/device-time-slots'
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isHealthProbeRequest(req) {
  return (req.method === 'GET' || req.method === 'HEAD') && (req.path === '/health' || req.path === '/ready');
}

function createApp({ config, db, service, refreshSessions, runtimeDiagnostics, server }) {
  const app = express();
  const createRateLimiter = (options) => db?.consumeRateLimit
    ? createDistributedRateLimiter({ ...options, consume: (key, windowMs) => db.consumeRateLimit(key, windowMs) })
    : createMemoryRateLimiter(options);
  const v5PublicDir = path.join(config.publicDir, 'v5');

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use(createRequestLogger());
  app.use(createSecurityHeaders(v5PublicDir));
  app.use(async (req, _res, next) => {
    try {
      if (!isHealthProbeRequest(req) && (isPublicPageRequest(req) || isPublicApiRequest(req)) && await service.shouldBlockIpAccess({ host: req.headers.host })) {
        throw new AppError('Direct IP access is disabled. Please use the configured domain.', { status: 403, code: 1003 });
      }
      next();
    } catch (error) { next(error); }
  });
  app.use(cors({ origin: corsOriginList(config), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 100 }));
  app.use('/wechat', express.text({ type: ['text/xml', 'application/xml', '*/xml', 'text/plain'], limit: '1mb' }));
  app.use('/api/v5/auth/login', createRateLimiter({
    windowMs: config.authRateLimitWindowMs, max: config.authRateLimitMax, maxKeys: 20_000,
    keyGenerator(req) {
      const account = String(req.body?.phone || 'admin').trim().toLowerCase().slice(0, 80);
      return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${account}`;
    },
    message: 'Too many login attempts. Please try again later.', code: 1004
  }));
  app.use('/uploads/exports', (_req, res) => res.status(404).end());
  app.use('/uploads', express.static(config.uploadDir, {
    maxAge: '7d', immutable: true,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }));

  app.use('/api/v5', createRateLimiter({
    windowMs: config.apiRateLimitWindowMs, max: config.apiRateLimitMax, maxKeys: 20_000,
    message: 'Too many requests. Please try again later.'
  }));
  app.use('/api/v5', createUploadRouter({ service, uploadDir: config.uploadDir }));
  app.use('/api/v5', createV5Router(service, { refreshSessions, runtimeDiagnostics }));
  app.use('/wechat', createWechatRouter(service));
  app.use(createHealthRouter(config, db));

  app.get('/', (_req, res) => res.redirect(302, '/v5/'));
  app.use('/v5', express.static(v5PublicDir, { index: false, maxAge: '7d', immutable: true }));
  app.use('/api', (req, res) => res.status(404).json({
    ok: false, code: 3004, message: 'The API endpoint does not exist or is no longer available.',
    data: null, status: 404, request_id: req.requestId || '', server_time: new Date().toISOString()
  }));
  app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && (req.path === '/v5' || req.path.startsWith('/v5/'))) {
      return res.sendFile(path.join(v5PublicDir, 'index.html'));
    }
    return next();
  });
  app.use((req, res) => res.status(404).json({
    ok: false, code: 3004, message: 'The requested resource does not exist.',
    data: null, status: 404, request_id: req.requestId || '', server_time: new Date().toISOString()
  }));
  app.use((err, req, res, _next) => {
    console.error('Unhandled request error', { requestId: req.requestId, method: req.method, url: safeRequestPath(req), message: err?.message || String(err), stack: err?.stack });
    sendError(res, err);
  });

  return app;
}

module.exports = { collectInlineScriptHashes, createApp, createSecurityHeaders, isHealthProbeRequest };
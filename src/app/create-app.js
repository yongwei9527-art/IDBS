const express = require('express');
const cors = require('cors');
const path = require('path');
const { corsOriginList } = require('../config/env');
const { AppError } = require('../lib/app-error');
const { sendError } = require('../lib/http');
const { createMemoryRateLimiter, createRequestLogger } = require('../lib/security');
const { createHealthRouter } = require('../routes/health');
const { createRestApiRouter } = require('../routes/rest-api');
const { createUploadRouter } = require('../routes/upload');
const { createWechatRouter } = require('../routes/wechat');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
}

function isPublicPageRequest(req) {
  if (req.method !== 'GET') return false;
  const pathname = req.path || '';
  if (pathname === '/admin.html' || pathname.startsWith('/api') || pathname.startsWith('/wechat') || pathname.startsWith('/uploads')) return false;
  if (pathname.startsWith('/js/') || pathname.startsWith('/css/')) return false;
  return pathname === '/' || pathname.endsWith('.html') || !path.extname(pathname);
}

function isPublicApiRequest(req) {
  const pathname = req.path || '';
  return [
    '/api/auth/register',
    '/api/login/challenge',
    '/api/login/status',
    '/api/devices',
    '/api/calendar',
    '/api/reservation-slots',
    '/api/device-time-slots'
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function createApp({ config, db, service }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(createRequestLogger());
  app.use(securityHeaders);
  app.use(async (req, res, next) => {
    try {
      if ((isPublicPageRequest(req) || isPublicApiRequest(req)) && await service.shouldBlockIpAccess({ host: req.headers.host })) {
        throw new AppError('当前系统已关闭 IP 直连注册/浏览，请使用管理员配置的域名访问。', { status: 403, code: 1003 });
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(cors({
    origin: corsOriginList(config),
    credentials: true
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/wechat', express.text({ type: ['text/xml', 'application/xml', '*/xml', 'text/plain'], limit: '1mb' }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', immutable: true }));
  app.use('/', express.static(config.publicDir, { extensions: ['html'] }));

  app.use('/api', createMemoryRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.API_RATE_LIMIT_MAX || 120),
    message: 'Too many API requests, please slow down.'
  }));
  app.use('/api', createUploadRouter({ service, uploadDir: config.uploadDir }));
  app.use('/api', createRestApiRouter(service));
  app.use('/wechat', createWechatRouter(service));
  app.use(createHealthRouter(config, db));

  app.use('/api', (req, res) => {
    res.status(404).json({
      ok: false,
      code: 3004,
      message: 'API endpoint not found',
      data: null,
      status: 404,
      request_id: req.requestId || '',
      server_time: new Date().toISOString()
    });
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use((err, req, res, next) => {
    console.error('Unhandled request error', {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
      message: err?.message || String(err),
      stack: err?.stack
    });
    sendError(res, err);
  });

  return app;
}

module.exports = { createApp };

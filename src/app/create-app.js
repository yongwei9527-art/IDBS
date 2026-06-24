const express = require('express');
const cors = require('cors');
const path = require('path');
const { corsOriginList } = require('../config/env');
const { sendError } = require('../lib/http');
const { createMemoryRateLimiter, createRequestLogger } = require('../lib/security');
const { createHealthRouter } = require('../routes/health');
const { createLegacyApiRouter } = require('../routes/legacy-api');
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

function createApp({ config, service }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(createRequestLogger());
  app.use(securityHeaders);
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
    max: 120,
    message: 'Too many API requests, please slow down.'
  }));
  app.use('/api', createUploadRouter({ service, uploadDir: config.uploadDir }));
  app.use('/api', createRestApiRouter(service));
  app.use('/api', createLegacyApiRouter(service));
  app.use('/wechat', createWechatRouter(service));
  app.use(createHealthRouter(config));

  app.get('*', (_, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

  app.use((err, req, res, next) => {
    console.error(err);
    sendError(res, err);
  });

  return app;
}

module.exports = { createApp };

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');
const { createRentalService } = require('./src/services/create-rental-service');
const { createLegacyApiRouter } = require('./src/routes/legacy-api');
const { createRestApiRouter } = require('./src/routes/rest-api');
const { sendError, success } = require('./src/lib/http');
const { createMemoryRateLimiter, createRequestLogger } = require('./src/lib/security');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'change-me-please';
const WECHAT_TOKEN = process.env.WECHAT_TOKEN || '';
const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || '';
const WECHAT_ADMIN_OPENIDS = process.env.WECHAT_ADMIN_OPENIDS || '';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const USE_CLOUDBASE = String(process.env.USE_CLOUDBASE || 'false').toLowerCase() === 'true';
const CDB_ENV_ID = process.env.CLOUDBASE_ENV_ID || process.env.ENV_ID || '';
const CDB_REGION = process.env.CLOUDBASE_REGION || 'ap-shanghai';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const db = USE_CLOUDBASE && CDB_ENV_ID
  ? cloudbase.init({ env: CDB_ENV_ID, region: CDB_REGION }).rdb()
  : {
      from() {
        throw new Error('Database client is not configured. Set USE_CLOUDBASE=true and provide CLOUDBASE_ENV_ID.');
      }
    };

const service = createRentalService({
  db,
  crypto,
  adminPassword: ADMIN_PASSWORD,
  tokenSecret: TOKEN_SECRET,
  wechatToken: WECHAT_TOKEN,
  wechatAppId: WECHAT_APP_ID,
  wechatAppSecret: WECHAT_APP_SECRET,
  wechatAdminOpenids: WECHAT_ADMIN_OPENIDS
});

function parseWechatXml(xmlText) {
  const text = String(xmlText || '');
  const pick = (tag) => {
    const match = text.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>|<${tag}>(.*?)<\\/${tag}>`, 's'));
    return (match && (match[1] || match[2] || '')).trim();
  };

  return {
    toUserName: pick('ToUserName'),
    fromUserName: pick('FromUserName'),
    msgType: pick('MsgType'),
    content: pick('Content'),
    event: pick('Event')
  };
}

function buildRuntimeStatus() {
  const warnings = [];

  if (!ADMIN_PASSWORD) warnings.push('ADMIN_PASSWORD is not configured');
  if (!TOKEN_SECRET || TOKEN_SECRET === 'change-me-please') warnings.push('TOKEN_SECRET is using the default value');
  if ((WECHAT_APP_ID && !WECHAT_APP_SECRET) || (!WECHAT_APP_ID && WECHAT_APP_SECRET)) warnings.push('WECHAT_APP_ID and WECHAT_APP_SECRET should be configured together');
  if (!USE_CLOUDBASE) warnings.push('USE_CLOUDBASE is false; business APIs require a real data backend');
  if (USE_CLOUDBASE && !CDB_ENV_ID) warnings.push('CLOUDBASE_ENV_ID is missing');

  return {
    ready: warnings.length === 0,
    mode: USE_CLOUDBASE && CDB_ENV_ID ? 'cloudbase' : 'standalone',
    warnings
  };
}

function scheduleNextDailyReportRun() {
  const fallbackDelayMs = 5 * 60 * 1000;

  const planNext = async () => {
    try {
      const reportConfig = await service.getReportConfig();
      if (!reportConfig.admin_report_enabled) {
        setTimeout(planNext, fallbackDelayMs);
        return;
      }

      const timeZone = reportConfig.admin_report_timezone || 'Asia/Shanghai';
      const now = new Date();
      const nowInTimezone = new Date(now.toLocaleString('en-US', { timeZone }));
      const nextRun = new Date(nowInTimezone);
      nextRun.setHours(reportConfig.admin_report_hour, reportConfig.admin_report_minute, 0, 0);
      if (nextRun <= nowInTimezone) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      const delay = Math.max(10_000, nextRun.getTime() - nowInTimezone.getTime());
      console.log(`Next daily usage report scheduled in ${Math.round(delay / 1000)}s (${timeZone} ${reportConfig.admin_report_hour}:${String(reportConfig.admin_report_minute).padStart(2, '0')})`);

      setTimeout(async () => {
        try {
          await service.pushDailyUsageReport({
            appId: WECHAT_APP_ID,
            appSecret: WECHAT_APP_SECRET,
            openids: WECHAT_ADMIN_OPENIDS,
            timezone: timeZone
          });
          console.log('Daily usage report push executed');
        } catch (error) {
          console.error('Daily usage report push failed:', error);
        } finally {
          planNext().catch((planError) => {
            console.error('Failed to reschedule daily usage report:', planError);
            setTimeout(planNext, fallbackDelayMs);
          });
        }
      }, delay);
    } catch (error) {
      console.error('Failed to schedule daily usage report:', error);
      setTimeout(planNext, fallbackDelayMs);
    }
  };

  planNext().catch((error) => {
    console.error('Daily report scheduler bootstrap failed:', error);
  });
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(createRequestLogger());
app.use(cors({
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((item) => item.trim()).filter(Boolean),
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/wechat', express.text({ type: ['text/xml', 'application/xml', '*/xml', 'text/plain'], limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));
app.use('/', express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', createMemoryRateLimiter({
  windowMs: 60_000,
  max: 120,
  message: 'Too many API requests, please slow down.'
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
});

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        code: 2001,
        message: 'file is required',
        data: null
      });
    }

    const filename = `${Date.now()}-${service.safeFilename(req.file.originalname)}`;
    const target = path.join(UPLOAD_DIR, filename);
    fs.renameSync(req.file.path, target);
    const url = `/uploads/${filename}`;
    return res.json({
      ...success({ url }),
      url
    });
  } catch (error) {
    return sendError(res, error);
  }
});

app.get('/wechat', async (req, res) => {
  try {
    const echostr = await service.verifyWechatHandshake(req.query || {});
    return res.type('text/plain').send(echostr);
  } catch (error) {
    return sendError(res, error);
  }
});

app.post('/wechat', async (req, res) => {
  try {
    await service.verifyWechatHandshake(req.query || {});
    const body = parseWechatXml(req.body || '');
    if (body.msgType !== 'text') {
      return res.type('application/xml').send(service.buildWechatReply(
        body.fromUserName,
        body.toUserName,
        '目前仅支持发送登录验证码。'
      ));
    }

    const reply = await service.handleWechatMessage({
      openid: body.fromUserName,
      content: body.content
    });

    return res.type('application/xml').send(service.buildWechatReply(
      body.fromUserName,
      body.toUserName,
      reply
    ));
  } catch (error) {
    console.error('WeChat callback failed:', error);
    return res.type('application/xml').send(service.buildWechatReply('', '', '系统繁忙，请稍后重试。'));
  }
});

app.use('/api', createRestApiRouter(service));
app.use('/api', createLegacyApiRouter(service));

app.get('/health', (_, res) => {
  res.json(success({
    status: 'ok',
    time: new Date().toISOString(),
    cloudbase: USE_CLOUDBASE
  }));
});

app.get('/ready', (_, res) => {
  const runtime = buildRuntimeStatus();
  const statusCode = runtime.ready ? 200 : 503;
  res.status(statusCode).json(success({
    status: runtime.ready ? 'ready' : 'degraded',
    time: new Date().toISOString(),
    runtime
  }));
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  sendError(res, err);
});

app.listen(PORT, () => {
  const runtime = buildRuntimeStatus();
  console.log(`VPS server running at http://0.0.0.0:${PORT}`);
  console.log(`Mode: ${USE_CLOUDBASE && CDB_ENV_ID ? 'CloudBase bridge' : 'Standalone HTTP API'}`);
  if (runtime.warnings.length) {
    console.warn(`Runtime warnings: ${runtime.warnings.join(' | ')}`);
  }
  scheduleNextDailyReportRun();
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

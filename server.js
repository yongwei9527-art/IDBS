require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const { createApp } = require('./src/app/create-app');
const { buildRuntimeStatus, loadConfig } = require('./src/config/env');
const { createDb } = require('./src/lib/db');
const { createRentalService } = require('./src/services/create-rental-service');
const { scheduleDailyUsageReport } = require('./src/tasks/daily-report-scheduler');

const config = loadConfig();

function ensureDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDirectory(config.uploadDir);

const db = createDb({
  connectionString: config.databaseUrl,
  ssl: config.pgssl
});

const service = createRentalService({
  db,
  crypto,
  adminPassword: config.adminPassword,
  tokenSecret: config.tokenSecret,
  wechatToken: config.wechatToken,
  wechatAppId: config.wechatAppId,
  wechatAppSecret: config.wechatAppSecret,
  wechatAdminOpenids: config.wechatAdminOpenids
});

const app = createApp({ config, db, service });
let reportScheduler = null;

const server = app.listen(config.port, () => {
  const runtime = buildRuntimeStatus(config);
  console.log(`VPS server running at http://0.0.0.0:${config.port}`);
  console.log(`Mode: ${config.databaseUrl ? 'PostgreSQL pool' : 'Standalone HTTP API'}`);
  if (runtime.warnings.length) {
    console.warn(`Runtime warnings: ${runtime.warnings.join(' | ')}`);
  }
  reportScheduler = scheduleDailyUsageReport({ service });
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  if (reportScheduler) reportScheduler.stop();
  server.close(async () => {
    try {
      await db.close();
    } catch (error) {
      console.error('Failed to close database pool:', error);
    } finally {
      process.exit(0);
    }
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

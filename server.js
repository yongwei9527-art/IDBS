require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const fs = require('fs');
const { createApp } = require('./src/app/create-app');
const { buildRuntimeStatus, corsOriginList, loadConfig } = require('./src/config/env');
const { createDb } = require('./src/lib/db');
const { getRuntimeDiagnostics } = require('./src/lib/runtime-diagnostics');
const { createWsGateway } = require('./src/lib/ws');
const { createRentalService } = require('./src/services/create-rental-service');
const { createRefreshSessionService } = require('./src/services/domains/auth/refresh-session-service');
const { scheduleDailyUsageReport } = require('./src/tasks/daily-report-scheduler');
const { scheduleMaintenanceWindows } = require('./src/tasks/maintenance-window-scheduler');
const { scheduleReservationReminders } = require('./src/tasks/reservation-reminder-scheduler');
const { scheduleChatTempGroupCleanup } = require('./src/tasks/chat-temp-group-scheduler');

const config = loadConfig();
const startupRuntime = buildRuntimeStatus(config);

if (startupRuntime.errors.length) {
  throw new Error(`Production configuration rejected: ${startupRuntime.errors.join(' | ')}`);
}

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
const refreshSessions = createRefreshSessionService({
  query: async (sql, params) => (await db.query(sql, params)).rows || [],
  sha256: (value) => crypto.createHash('sha256').update(String(value)).digest('hex'),
  withTransaction: (work) => db.transaction(work)
});

let wsGateway = null;
let realtimeBus = null;
let reportScheduler = null;
let maintenanceWindowScheduler = null;
let reservationReminderScheduler = null;
let chatTempGroupScheduler = null;
let systemMaintenanceTimer = null;
let shuttingDown = false;
const processStartedAt = new Date().toISOString();
const service = createRentalService({
  db,
  crypto,
  adminPassword: config.adminPassword,
  tokenSecret: config.tokenSecret,
  uploadDir: config.uploadDir,
  wechatToken: config.wechatToken,
  wechatAppId: config.wechatAppId,
  wechatAppSecret: config.wechatAppSecret,
  wechatAdminOpenids: config.wechatAdminOpenids,
  async realtimePublisher(channel, message) {
    const delivered = wsGateway ? wsGateway.broadcast(channel, message) : 0;
    if (realtimeBus) await realtimeBus.publish(message);
    return delivered;
  }
});

const runtimeDiagnostics = () => getRuntimeDiagnostics(config, db, {
  startedAt: processStartedAt,
  schedulerActive: Boolean(reportScheduler),
  maintenanceWindowSchedulerActive: Boolean(maintenanceWindowScheduler),
  realtimeBusActive: Boolean(realtimeBus),
  websocketActive: Boolean(wsGateway)
});
const app = createApp({ config, db, service, refreshSessions, runtimeDiagnostics, server: null });

const http = require('http');
const httpServer = http.createServer(app);
const configuredOrigins = corsOriginList(config);
const allowedRealtimeOrigins = configuredOrigins === true ? null : new Set(configuredOrigins);
wsGateway = createWsGateway(httpServer, {
  resolvePrincipal: (auth) => service.resolveRealtimePrincipal(auth),
  authorizeChannel: (auth, channel) => {
    if (!channel.startsWith('chat:')) return false;
    const conversationId = channel.slice('chat:'.length).trim();
    return service.canSubscribeChatChannel(auth.sub, conversationId);
  },
  isOriginAllowed(origin) {
    return !origin || !allowedRealtimeOrigins || allowedRealtimeOrigins.has(origin);
  }
});
app.locals.wsGateway = wsGateway;
db.createRealtimeBus((message) => {
  if (message?.channel) wsGateway.broadcast(message.channel, message);
}).then((bus) => {
  realtimeBus = bus;
}).catch((error) => {
  console.warn('Distributed realtime bus unavailable:', error.message || error);
});

const server = httpServer.listen(config.port, () => {
  console.log(`VPS server running at http://0.0.0.0:${config.port}`);
  console.log(`Mode: ${config.databaseUrl ? 'PostgreSQL pool' : 'Standalone HTTP API'}`);
  if (startupRuntime.warnings.length) {
    console.warn(`Runtime warnings: ${startupRuntime.warnings.join(' | ')}`);
  }
  if (config.enableSchedulers) {
    service.bootstrapSystem?.().catch((error) => {
      console.warn('System bootstrap skipped:', error.message || error);
    });
    systemMaintenanceTimer = setInterval(() => {
      service.bootstrapSystem?.().catch((error) => {
        console.warn('System maintenance skipped:', error.message || error);
      });
    }, 60 * 60 * 1000);
    systemMaintenanceTimer.unref?.();
    reportScheduler = scheduleDailyUsageReport({ service, db });
    maintenanceWindowScheduler = scheduleMaintenanceWindows({ service, db });
    reservationReminderScheduler = scheduleReservationReminders({ service, db });
    chatTempGroupScheduler = scheduleChatTempGroupCleanup({ service });
  } else {
    console.log('Background schedulers are disabled for this runtime.');
  }
});

async function shutdown(signal) {
  if (shuttingDown) {
    console.warn(`${signal} received while shutdown is already in progress.`);
    return;
  }
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);
  const forcedExit = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forcedExit.unref();

  try {
    if (reportScheduler) reportScheduler.stop();
    if (maintenanceWindowScheduler) maintenanceWindowScheduler.stop();
    if (reservationReminderScheduler) reservationReminderScheduler.stop();
    if (chatTempGroupScheduler) chatTempGroupScheduler.stop();
    if (systemMaintenanceTimer) clearInterval(systemMaintenanceTimer);
    if (wsGateway) wsGateway.close();
    if (realtimeBus) await realtimeBus.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    clearTimeout(forcedExit);
    process.exit(0);
  } catch (error) {
    console.error('Graceful shutdown failed:', error);
    clearTimeout(forcedExit);
    process.exit(1);
  }
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});



const { buildRuntimeStatus } = require('../config/env');

function roundMilliseconds(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

async function getDatabaseStatus(config, db) {
  if (!config.databaseUrl) return { postgres: false, ready: false, latency_ms: null };
  if (!db) return { postgres: true, ready: false, latency_ms: null };

  try {
    if (typeof db.healthStatus === 'function') {
      const status = await db.healthStatus();
      return {
        postgres: true,
        ready: Boolean(status?.ready),
        latency_ms: Number.isFinite(status?.latency_ms) ? roundMilliseconds(status.latency_ms) : null,
        checked_at: status?.checked_at || new Date().toISOString()
      };
    }
    const startedAt = process.hrtime.bigint();
    const ready = await db.healthCheck();
    return {
      postgres: true,
      ready: Boolean(ready),
      latency_ms: roundMilliseconds(Number(process.hrtime.bigint() - startedAt) / 1_000_000),
      checked_at: new Date().toISOString()
    };
  } catch (_) {
    return { postgres: true, ready: false, latency_ms: null, checked_at: new Date().toISOString() };
  }
}

async function getReadinessStatus(config, db) {
  const runtime = buildRuntimeStatus(config);
  const database = await getDatabaseStatus(config, db);
  if (config.databaseUrl && !database.ready) {
    runtime.ready = false;
    runtime.warnings.push('PostgreSQL health check failed');
  }
  return {
    status: runtime.ready ? 'ready' : 'degraded',
    time: new Date().toISOString(),
    database,
    runtime
  };
}

async function getRuntimeDiagnostics(config, db, options = {}) {
  const readiness = await getReadinessStatus(config, db);
  return {
    product_version: '5.0.0',
    process: {
      uptime_seconds: Math.floor(process.uptime()),
      node_version: process.version,
      environment: config.nodeEnv || process.env.NODE_ENV || 'development',
      started_at: options.startedAt || null
    },
    readiness,
    components: {
      scheduler: options.schedulerActive === true ? 'active' : 'inactive',
      maintenance_window_scheduler: options.maintenanceWindowSchedulerActive === true ? 'active' : 'inactive',
      realtime_bus: options.realtimeBusActive === true ? 'active' : 'inactive',
      websocket_gateway: options.websocketActive === true ? 'active' : 'inactive'
    }
  };
}

module.exports = { getDatabaseStatus, getReadinessStatus, getRuntimeDiagnostics };

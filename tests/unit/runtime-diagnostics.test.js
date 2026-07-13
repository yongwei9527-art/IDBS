const test = require('node:test');
const assert = require('node:assert/strict');
const { getReadinessStatus, getRuntimeDiagnostics } = require('../../src/lib/runtime-diagnostics');

const config = {
  nodeEnv: 'development',
  adminPassword: 'IDBS_strong_admin_2026',
  tokenSecret: 'IDBS_token_secret_at_least_32_characters_2026',
  databaseUrl: 'postgresql://example.invalid/idbs',
  corsOrigin: 'https://idbs.example.edu',
  port: 3000,
  authRateLimitMax: 10,
  authRateLimitWindowMs: 60_000,
  apiRateLimitMax: 120,
  apiRateLimitWindowMs: 60_000,
  trustProxy: false,
  pgssl: false,
  pgsslRejectUnauthorized: true,
  wechatAppId: '',
  wechatAppSecret: ''
};

test('readiness includes database latency without exposing connection details', async () => {
  const readiness = await getReadinessStatus(config, {
    healthStatus: async () => ({ ready: true, latency_ms: 12.4, checked_at: '2026-07-12T00:00:00.000Z' })
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.database.ready, true);
  assert.equal(readiness.database.latency_ms, 12);
  assert.equal(readiness.database.checked_at, '2026-07-12T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(readiness), /example.invalid/);
});

test('runtime diagnostics reports only safe component state', async () => {
  const diagnostics = await getRuntimeDiagnostics(config, {
    healthStatus: async () => ({ ready: true, latency_ms: 3, checked_at: '2026-07-12T00:00:00.000Z' })
  }, {
    startedAt: '2026-07-12T00:00:00.000Z',
    schedulerActive: true,
    maintenanceWindowSchedulerActive: true,
    realtimeBusActive: true,
    websocketActive: true
  });

  assert.equal(diagnostics.product_version, '5.0.0');
  assert.equal(diagnostics.components.scheduler, 'active');
  assert.equal(diagnostics.components.maintenance_window_scheduler, 'active');
  assert.equal(diagnostics.components.realtime_bus, 'active');
  assert.equal(diagnostics.components.websocket_gateway, 'active');
  assert.equal(diagnostics.process.started_at, '2026-07-12T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(diagnostics), /postgresql:|example.invalid/);
});

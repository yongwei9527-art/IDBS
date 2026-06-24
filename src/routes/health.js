const express = require('express');
const { success } = require('../lib/http');
const { buildRuntimeStatus } = require('../config/env');

function createHealthRouter(config, db) {
  const router = express.Router();

  router.get('/health', (_, res) => {
    res.json(success({
      status: 'ok',
      time: new Date().toISOString(),
      postgres: !!config.databaseUrl
    }));
  });

  router.get('/ready', async (_, res) => {
    const runtime = buildRuntimeStatus(config);
    let databaseReady = false;
    if (config.databaseUrl && db && db.healthCheck) {
      try {
        databaseReady = await db.healthCheck();
      } catch (error) {
        runtime.warnings.push(`PostgreSQL health check failed: ${error.message || error}`);
      }
    }
    if (config.databaseUrl && !databaseReady) {
      runtime.ready = false;
    }
    const statusCode = runtime.ready ? 200 : 503;
    res.status(statusCode).json(success({
      status: runtime.ready ? 'ready' : 'degraded',
      time: new Date().toISOString(),
      database: {
        postgres: !!config.databaseUrl,
        ready: databaseReady
      },
      runtime
    }));
  });

  return router;
}

module.exports = { createHealthRouter };

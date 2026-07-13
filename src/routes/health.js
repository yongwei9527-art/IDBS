const express = require('express');
const { success } = require('../lib/http');
const { getReadinessStatus } = require('../lib/runtime-diagnostics');

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
    const readiness = await getReadinessStatus(config, db);
    res.status(readiness.runtime.ready ? 200 : 503).json(success(readiness));
  });

  return router;
}

module.exports = { createHealthRouter };

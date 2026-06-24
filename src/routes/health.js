const express = require('express');
const { success } = require('../lib/http');
const { buildRuntimeStatus } = require('../config/env');

function createHealthRouter(config) {
  const router = express.Router();

  router.get('/health', (_, res) => {
    res.json(success({
      status: 'ok',
      time: new Date().toISOString(),
      postgres: !!config.databaseUrl
    }));
  });

  router.get('/ready', (_, res) => {
    const runtime = buildRuntimeStatus(config);
    const statusCode = runtime.ready ? 200 : 503;
    res.status(statusCode).json(success({
      status: runtime.ready ? 'ready' : 'degraded',
      time: new Date().toISOString(),
      runtime
    }));
  });

  return router;
}

module.exports = { createHealthRouter };

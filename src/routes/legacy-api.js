const express = require('express');
const { sendError, sendLegacy } = require('../lib/http');

function createLegacyApiRouter(service) {
  const router = express.Router();

  router.post('/:action', async (req, res) => {
    try {
      const action = req.params.action;
      const handler = service.legacyRoutes[action];
      if (!handler) {
        return sendLegacy(res, {
          ok: false,
          status: 404,
          code: 3004,
          message: `Unknown action: ${action}`
        });
      }

      const result = action === 'loginUser'
        ? await handler(req.body || {}, { deviceType: req.deviceType })
        : await handler(req.body || {}, service.authTokenFromReq(req));
      return sendLegacy(res, result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}

module.exports = { createLegacyApiRouter };

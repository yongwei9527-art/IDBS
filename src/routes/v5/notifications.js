const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function createV5NotificationRouter(service) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/notifications', wrapV5(async (req) => unwrap(await service.listMyNotifications(req.query || {}, serviceAuth(req)))));
  router.patch('/notifications/read', wrapV5(async (req) => unwrap(await service.markMyNotificationsRead(req.body || {}, serviceAuth(req)))));
  return router;
}

module.exports = { createV5NotificationRouter };

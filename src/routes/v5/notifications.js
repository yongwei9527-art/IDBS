const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function createV5NotificationRouter(service) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/notifications', wrapV5(async (req) => unwrap(await service.listMyNotifications(req.query || {}, serviceAuth(req)))));
  router.patch('/notifications/read', wrapV5(async (req) => unwrap(await service.markMyNotificationsRead(req.body || {}, serviceAuth(req)))));
  router.get('/notifications/push-status', wrapV5(async (req) => unwrap(await service.getMyPushStatus(req.query || {}, serviceAuth(req)))));
  router.post('/notifications/push-devices', validate({ body: z.object({
    token: z.string().min(32).max(4096),
    platform: z.literal('android').optional()
  }).strict() }), wrapV5(async (req) => unwrap(await service.registerPushDevice(req.validated.body, serviceAuth(req)))));
  router.delete('/notifications/push-devices', validate({ body: z.object({ token: z.string().min(32).max(4096) }).strict() }), wrapV5(async (req) => unwrap(await service.unregisterPushDevice(req.validated.body, serviceAuth(req)))));
  return router;
}

module.exports = { createV5NotificationRouter };

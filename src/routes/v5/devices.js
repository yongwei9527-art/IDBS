const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function createV5DevicesRouter(service) {
  const router = express.Router();
  router.get('/devices', wrapV5(async (req) => unwrap(await service.listDevices(req.query || {}))));
  router.get('/devices/:deviceCode', wrapV5(async (req) => unwrap(await service.getDeviceDetail({ deviceCode: req.params.deviceCode }))));
  router.get('/device-time-slots', wrapV5(async (req) => unwrap(await service.getDeviceTimeSlots(req.query || {}))));
  router.get('/reservation-slots', wrapV5(async (req) => unwrap(await service.getReservationSlotOptions(req.query || {}))));
  router.post('/admin/devices', requireAuth, requirePerm('device.manage'), wrapV5(async (req) => unwrap(await service.adminCreateDevice(req.body || {}, serviceAuth(req)))));
  router.put('/admin/devices/:deviceId', requireAuth, requirePerm('device.manage'), validate({ body: z.object({}).passthrough(), params: z.object({ deviceId: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminUpdateDevice({ ...req.validated.body, id: req.validated.params.deviceId }, serviceAuth(req)))));
  return router;
}

module.exports = { createV5DevicesRouter };

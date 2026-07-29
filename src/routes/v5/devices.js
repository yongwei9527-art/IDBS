const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function createV5DevicesRouter(service) {
  const router = express.Router();
  const deleteIdSchema = z.string().trim().min(1).max(60);
  const deleteBatchSchema = z.object({
    ids: z.array(deleteIdSchema).min(1).max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'ids must not contain duplicates')
  }).strict();
  router.get('/devices', wrapV5(async (req) => unwrap(await service.listDevices(req.query || {}))));
  router.get('/devices/:deviceCode', wrapV5(async (req) => unwrap(await service.getDeviceDetail({ deviceCode: req.params.deviceCode }))));
  router.get('/device-time-slots', wrapV5(async (req) => unwrap(await service.getDeviceTimeSlots(req.query || {}))));
  router.get('/reservation-slots', wrapV5(async (req) => unwrap(await service.getReservationSlotOptions(req.query || {}))));
  router.post('/admin/devices', requireAuth, requirePerm('device.manage'), wrapV5(async (req) => unwrap(await service.adminCreateDevice(req.body || {}, serviceAuth(req)))));
  router.delete('/admin/devices/batch', requireAuth, requireRole('super_admin'), validate({
    body: deleteBatchSchema
  }), wrapV5(async (req) => unwrap(await service.adminDeleteDevices({
    device_ids: req.validated.body.ids
  }, serviceAuth(req)))));
  router.delete('/admin/devices/:deviceId', requireAuth, requireRole('super_admin'), validate({
    params: z.object({ deviceId: deleteIdSchema }).strict()
  }), wrapV5(async (req) => unwrap(await service.adminDeleteDevice({
    device_id: req.validated.params.deviceId
  }, serviceAuth(req)))));
  router.put('/admin/devices/:deviceId', requireAuth, requirePerm('device.manage'), validate({ body: z.object({}).passthrough(), params: z.object({ deviceId: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminUpdateDevice({ ...req.validated.body, id: req.validated.params.deviceId }, serviceAuth(req)))));
  return router;
}

module.exports = { createV5DevicesRouter };

const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function createV5ReservationsRouter(service) {
  const router = express.Router();
  router.get('/calendar', optionalAuth, wrapV5(async (req) => unwrap(await service.getCalendarEvents(req.query || {}, serviceAuth(req)))));
  router.get('/calendar/days/:date', optionalAuth, wrapV5(async (req) => unwrap(await service.getCalendarDay({ ...req.query, date: req.params.date }, serviceAuth(req)))));
  router.post('/reservation-batches/precheck', requireAuth, wrapV5(async (req) => unwrap(await service.precheckReservation(req.body || {}, serviceAuth(req)))));
  router.post('/reservation-batches', requireAuth, wrapV5(async (req) => unwrap(await service.createReservation(req.body || {}, serviceAuth(req)))));
  router.get('/reservation-batches/me', requireAuth, wrapV5(async (req) => unwrap(await service.listReservationBatches(req.query || {}, serviceAuth(req)))));
  router.post('/reservation-batches/:id/start-use', requireAuth, wrapV5(async (req) => unwrap(await service.startReservationBatch({ ...req.body, batch_id: req.params.id }, serviceAuth(req)))));
  router.get('/reservation-batches/:id', requireAuth, wrapV5(async (req) => unwrap(await service.getReservationBatch({ ...req.query, id: req.params.id }, serviceAuth(req)))));
  router.patch('/reservation-items/:id/cancel', requireAuth, wrapV5(async (req) => unwrap(await service.cancelReservationItem({ ...req.body, id: req.params.id }, serviceAuth(req)))));
  router.patch('/admin/reservation-items/:id/cancel-review', requirePerm('reservation.approve'), validate({ body: z.object({ approved: z.boolean(), admin_note: z.string().max(500).optional() }).passthrough(), params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminReviewReservationCancellation({ ...req.validated.body, id: req.validated.params.id }, serviceAuth(req)))));
  return router;
}

module.exports = { createV5ReservationsRouter };

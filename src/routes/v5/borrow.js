const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function createV5BorrowRouter(service) {
  const router = express.Router();
  router.get('/my-records', requireAuth, wrapV5(async (req) => unwrap(await service.myRecords(req.query || {}, serviceAuth(req)))));
  router.post('/borrow-records', requireAuth, wrapV5(async (req) => unwrap(await service.startUse(req.body || {}, serviceAuth(req)))));
  router.put('/borrow-records/:recordId/return', requireAuth, wrapV5(async (req) => unwrap(await service.submitReturn({ ...req.body, record_id: req.params.recordId }, serviceAuth(req)))));
  router.patch('/borrow-records/:recordId/return-supplement', requireAuth, wrapV5(async (req) => unwrap(await service.supplementReturnMaterials({ ...req.body, record_id: req.params.recordId }, serviceAuth(req)))));
  router.post('/borrow-records/:recordId/extend/precheck', requireAuth, wrapV5(async (req) => unwrap(await service.precheckBorrowExtension({ ...req.body, record_id: req.params.recordId }, serviceAuth(req)))));
  router.patch('/borrow-records/:recordId/extend', requireAuth, wrapV5(async (req) => unwrap(await service.extendBorrow({ ...req.body, record_id: req.params.recordId }, serviceAuth(req)))));
  router.get('/fault-reports', requireAuth, wrapV5(async (req) => unwrap(await service.listMyFaultReports(req.query || {}, serviceAuth(req)))));
  router.post('/fault-reports', requireAuth, wrapV5(async (req) => unwrap(await service.reportDeviceFault(req.body || {}, serviceAuth(req)))));
  router.get('/user-requests', requireAuth, wrapV5(async (req) => unwrap(await service.listMyUserRequests(req.query || {}, serviceAuth(req)))));
  router.post('/user-requests', requireAuth, wrapV5(async (req) => unwrap(await service.createUserRequest(req.body || {}, serviceAuth(req)))));
  router.put('/user-requests/:id', requireAuth, wrapV5(async (req) => unwrap(await service.updateUserRequest({ ...req.body, request_id: req.params.id }, serviceAuth(req)))));
  router.patch('/user-requests/:id/cancel', requireAuth, wrapV5(async (req) => unwrap(await service.cancelUserRequest({ ...req.body, request_id: req.params.id }, serviceAuth(req)))));
  router.post('/user-requests/:id/change-request', requireAuth, wrapV5(async (req) => unwrap(await service.requestUserRequestChange({ ...req.body, request_id: req.params.id }, serviceAuth(req)))));
  return router;
}

module.exports = { createV5BorrowRouter };

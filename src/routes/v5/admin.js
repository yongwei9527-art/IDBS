const {
  express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError, unwrap, serviceAuth
} = require('./helpers');

function createV5AdminRouter(service, { runtimeDiagnostics } = {}) {
  const router = express.Router();
  router.use(requireAuth);
  // dashboard
  router.get('/admin/dashboard', requirePerm('stats.view', 'device.view', 'reservation.view', 'reservation.approve', 'reservation.change_plan', 'user.approve', 'user.manage', 'device.manage', 'fault.manage', 'return.view', 'return.confirm', 'return.image_review', 'return.export', 'stats.export', 'audit.view'), wrapV5(async (req) => unwrap(await service.adminDashboard(req.query || {}, serviceAuth(req)))));
  // users
  router.get('/admin/users', requirePerm('user.manage', 'user.approve'), wrapV5(async (req) => unwrap(await service.adminListUsers(req.query || {}, serviceAuth(req)))));
  router.get('/admin/users/:id', requirePerm('user.manage', 'user.approve'), wrapV5(async (req) => unwrap(await service.adminGetUserDetail({ ...req.query, id: req.params.id }, serviceAuth(req)))));
  router.patch('/admin/users/:id/status', requirePerm('user.manage', 'user.approve'), validate({ body: z.object({ status: z.string() }).passthrough(), params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminSetUserStatus({ ...req.validated.body, user_id: req.validated.params.id }, serviceAuth(req)))));
  router.put('/admin/users/:id/ban', requirePerm('user.manage'), validate({ body: z.object({}).passthrough(), params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminSetUserBan({ ...req.validated.body, user_id: req.validated.params.id }, serviceAuth(req)))));
  router.delete('/admin/users/:id/wechat-binding', requirePerm('user.manage'), validate({ params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminUnbindWechat({ user_id: req.validated.params.id }, serviceAuth(req)))));
  router.delete('/admin/users/:id', requirePerm('user.manage'), validate({ params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminDeleteUser({ user_id: req.validated.params.id }, serviceAuth(req)))));
  // devices list/detail/update (admin)
  router.get('/admin/devices', requirePerm('device.view', 'device.manage'), wrapV5(async (req) => unwrap(await service.adminListDevices(req.query || {}, serviceAuth(req)))));
  router.get('/admin/devices/:id', requirePerm('device.view', 'device.manage'), wrapV5(async (req) => unwrap(await service.adminGetDeviceDetail({ ...req.query, id: req.params.id }, serviceAuth(req)))));
  router.patch('/admin/devices/:id/availability', requirePerm('device.manage'), validate({ body: z.object({ available: z.boolean().optional() }).passthrough(), params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminSetDeviceAvailable({ ...req.validated.body, device_id: req.validated.params.id, id: req.validated.params.id }, serviceAuth(req)))));
  // fault reports
  router.get('/admin/fault-reports', requirePerm('device.view', 'fault.manage', 'device.manage'), wrapV5(async (req) => unwrap(await service.adminListFaultReports(req.query || {}, serviceAuth(req)))));
  router.patch('/admin/fault-reports/:id/resolve', requirePerm('device.manage', 'fault.manage'), validate({ body: z.object({}).passthrough(), params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminResolveFaultReport({ ...req.validated.body, report_id: req.validated.params.id }, serviceAuth(req)))));
  router.post('/admin/fault-reports/:id/notify-affected', requirePerm('device.manage', 'fault.manage'), wrapV5(async (req) => unwrap(await service.adminNotifyAffectedFaultUsers({ ...req.body, report_id: req.params.id }, serviceAuth(req)))));
  router.get('/admin/return-tasks', requirePerm('return.view', 'return.confirm', 'return.image_review', 'device.manage'), wrapV5(async (req) => unwrap(await service.adminListReturnTasks(req.query || {}, serviceAuth(req)))));
  router.patch('/admin/return-tasks/:id/review', requirePerm('return.confirm'), validate({ body: z.object({ approved: z.boolean().optional(), review_note: z.string().max(500).optional() }).passthrough(), params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminReviewReturn({ ...req.validated.body, record_id: req.validated.params.id }, serviceAuth(req)))));
  // user requests / demands
  router.get('/admin/user-requests', requirePerm('user.manage', 'reservation.view', 'reservation.approve'), wrapV5(async (req) => unwrap(await service.adminListUserRequests(req.query || {}, serviceAuth(req)))));
  router.patch('/admin/user-requests/:id/review', requirePerm('user.manage'), validate({ body: z.object({}).passthrough(), params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminReviewUserRequest({ ...req.validated.body, request_id: req.validated.params.id }, serviceAuth(req)))));
  // analytics
  router.get('/admin/analytics/overview', requirePerm('stats.view'), wrapV5(async (req) => unwrap(await service.adminAnalyticsOverview(req.query || {}, serviceAuth(req)))));
  router.get('/admin/analytics/device-usage', requirePerm('stats.view'), wrapV5(async (req) => unwrap(await service.adminAnalyticsDeviceUsage(req.query || {}, serviceAuth(req)))));
  router.get('/admin/analytics/time-heatmap', requirePerm('stats.view'), wrapV5(async (req) => unwrap(await service.adminAnalyticsTimeHeatmap(req.query || {}, serviceAuth(req)))));
  router.get('/admin/analytics/faults', requirePerm('stats.view'), wrapV5(async (req) => unwrap(await service.adminAnalyticsFaults(req.query || {}, serviceAuth(req)))));
  router.get('/admin/analytics/intelligence', requirePerm('stats.view'), wrapV5(async (req) => unwrap(await service.adminAnalyticsIntelligence(req.query || {}, serviceAuth(req)))));
  router.get('/admin/analytics/intelligence/actions', requirePerm('stats.view'), wrapV5(async (req) => unwrap(await service.adminListIntelligenceActionLogs(req.query || {}, serviceAuth(req)))));
  router.patch('/admin/analytics/intelligence/actions/:actionId', requirePerm('stats.view'), validate({ body: z.object({}).passthrough(), params: z.object({ actionId: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminUpdateIntelligenceAction({ ...req.validated.body, action_id: req.validated.params.actionId }, serviceAuth(req)))));
  // export jobs
  router.get('/admin/exports/:type', requirePerm('stats.export'), wrapV5(async (req) => unwrap(await service.adminExportData({ ...req.query, type: req.params.type }, serviceAuth(req)))));
  router.get('/admin/export-jobs/:id/download', requirePerm('stats.export'), validate({ params: z.object({ id: z.string() }) }), async (req, res, next) => {
    try {
      const download = unwrap(await service.adminGetExportJobDownload({ id: req.validated.params.id }, serviceAuth(req)));
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.download(download.absolutePath, download.download_name, (error) => { if (error) next(error); });
    } catch (error) { return next(error); }
  });
  router.post('/admin/export-jobs', requirePerm('stats.export'), wrapV5(async (req) => unwrap(await service.adminCreateExportJob(req.body || {}, serviceAuth(req)))));
  router.get('/admin/export-jobs', requirePerm('stats.export'), wrapV5(async (req) => unwrap(await service.adminListExportJobs(req.query || {}, serviceAuth(req)))));
  router.post('/admin/export-jobs/run-next', requirePerm('stats.export'), wrapV5(async (req) => unwrap(await service.adminRunNextExportJob(req.body || {}, serviceAuth(req)))));
  // system config
  router.get('/admin/system/runtime', requireRole('super_admin'), wrapV5(async () => {
    if (typeof runtimeDiagnostics !== 'function') {
      return { product_version: '5.0.0', status: 'unavailable' };
    }
    return runtimeDiagnostics();
  }));
  router.get('/admin/system/security-config', requireRole('super_admin'), wrapV5(async (req) => unwrap(await service.adminGetSecurityConfig({}, serviceAuth(req)))));
  router.put('/admin/system/security-config', requireRole('super_admin'), wrapV5(async (req) => unwrap(await service.adminUpdateSecurityConfig(req.body || {}, serviceAuth(req)))));
  router.get('/admin/system/activity-summary', requireRole('super_admin'), wrapV5(async (req) => unwrap(await service.adminGetActivitySummary(req.query || {}, serviceAuth(req)))));
  router.get('/admin/system/reports/daily-usage', requirePerm('stats.view'), wrapV5(async (req) => unwrap(await service.adminPreviewDailyUsageReport(req.query || {}, serviceAuth(req)))));
  router.post('/admin/system/reports/daily-usage/send', requirePerm('stats.export'), wrapV5(async (req) => unwrap(await service.adminSendDailyUsageReport(req.body || {}, serviceAuth(req)))));
  router.get('/admin/system/roles', requireRole('super_admin'), wrapV5(async (req) => unwrap(await service.adminListRoles({}, serviceAuth(req)))));
  router.put('/admin/system/roles', requireRole('super_admin'), wrapV5(async (req) => unwrap(await service.adminUpsertRole(req.body || {}, serviceAuth(req)))));
  router.delete('/admin/system/roles/:userId', requireRole('super_admin'), validate({ params: z.object({ userId: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminRevokeRole({ user_id: req.validated.params.userId }, serviceAuth(req)))));
  // maintenance plans, work orders and reservation-blocking maintenance windows
  router.get('/admin/maintenance/overview', requirePerm('device.view', 'device.manage', 'fault.manage'), wrapV5(async (req) => unwrap(await service.adminMaintenanceOverview(req.query || {}, serviceAuth(req)))));
  router.get('/admin/maintenance/plans', requirePerm('device.view', 'device.manage', 'fault.manage'), wrapV5(async (req) => unwrap(await service.adminListMaintenancePlans(req.query || {}, serviceAuth(req)))));
  router.post('/admin/maintenance/plans', requirePerm('device.manage', 'fault.manage'), wrapV5(async (req) => unwrap(await service.adminCreateMaintenancePlan(req.body || {}, serviceAuth(req)))));
  router.patch('/admin/maintenance/plans/:id', requirePerm('device.manage', 'fault.manage'), wrapV5(async (req) => unwrap(await service.adminUpdateMaintenancePlan({ ...req.body, id: req.params.id }, serviceAuth(req)))));
  router.get('/admin/maintenance/work-orders', requirePerm('device.view', 'device.manage', 'fault.manage'), wrapV5(async (req) => unwrap(await service.adminListMaintenanceWorkOrders(req.query || {}, serviceAuth(req)))));
  router.post('/admin/maintenance/work-orders', requirePerm('device.manage', 'fault.manage'), wrapV5(async (req) => unwrap(await service.adminCreateMaintenanceWorkOrder(req.body || {}, serviceAuth(req)))));
  router.patch('/admin/maintenance/work-orders/:id', requirePerm('device.manage', 'fault.manage'), wrapV5(async (req) => unwrap(await service.adminUpdateMaintenanceWorkOrder({ ...req.body, id: req.params.id }, serviceAuth(req)))));
  // audit operation logs
  router.get('/admin/audit/operation-logs', requirePerm('audit.view'), wrapV5(async (req) => unwrap(await service.adminOperationLogs(req.query || {}, serviceAuth(req)))));
  // reservations approval
  router.get('/admin/reservations', requirePerm('reservation.view', 'reservation.approve', 'reservation.change_plan'), wrapV5(async (req) => unwrap(await service.adminListReservations(req.query || {}, serviceAuth(req)))));
  router.get('/admin/reservation-batches', requirePerm('reservation.view', 'reservation.approve', 'reservation.change_plan'), wrapV5(async (req) => unwrap(await service.adminListReservationBatches(req.query || {}, serviceAuth(req)))));
  router.get('/admin/reservation-batches/:id', requirePerm('reservation.view', 'reservation.approve', 'reservation.change_plan'), wrapV5(async (req) => unwrap(await service.adminGetReservationBatch({ ...req.query, id: req.params.id }, serviceAuth(req)))));
  router.patch('/admin/reservation-batches/:id/approval', requirePerm('reservation.approve'), wrapV5(async (req) => unwrap(await service.adminApproveReservationBatch({ ...req.body, id: req.params.id }, serviceAuth(req)))));
  router.patch('/admin/reservation-items/:id/approval', requirePerm('reservation.approve'), wrapV5(async (req) => unwrap(await service.adminApproveReservation({ ...req.body, reservation_id: req.params.id }, serviceAuth(req)))));
  router.patch('/admin/reservation-items/:id/plan', requirePerm('reservation.change_plan'), wrapV5(async (req) => unwrap(await service.adminChangeReservationPlan({ ...req.body, id: req.params.id, reservation_item_id: req.params.id }, serviceAuth(req)))));
  router.patch('/admin/reservation-items/:id/no-show', requirePerm('reservation.approve'), wrapV5(async (req) => unwrap(await service.adminMarkReservationNoShow({ ...req.body, id: req.params.id, reservation_item_id: req.params.id }, serviceAuth(req)))));
  return router;
}

module.exports = { createV5AdminRouter };

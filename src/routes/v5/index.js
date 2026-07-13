const express = require('express');
const { z } = require('zod');
const { validate } = require('../../lib/validate');
const { wrapV5 } = require('../../lib/v5-http');
const { requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt } = require('../../lib/auth');
const { AppError } = require('../../lib/app-error');
const { createV5AuthRouter } = require('./auth');

// unwrap：把 2.x service 的 {ok,data,message,status,code} 归一为 v5 data。
// 失败时抛 AppError，由 wrapV5 统一转成 problem+json 或失败体。
function unwrap(result) {
  if (!result) return null;
  if (result && result.ok === false) {
    const r = result;
    const err = new AppError(r.message || '请求处理失败。', { status: r.status || 400, code: r.code || 2001, data: r.data || null });
    throw err;
  }
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function serviceAuth(req) {
  return req.auth || '';
}

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

function createV5PublicSystemRouter(service) {
  const router = express.Router();
  router.get('/system/notice', wrapV5(async () => unwrap(await service.getSystemNotice())));
  router.get('/system/staff-contacts', wrapV5(async () => unwrap(await service.getStaffContacts())));
  return router;
}

function createV5ReservationsRouter(service) {
  const router = express.Router();
  router.get('/calendar', optionalAuth, wrapV5(async (req) => unwrap(await service.getCalendarEvents(req.query || {}, serviceAuth(req)))));
  router.get('/calendar/days/:date', optionalAuth, wrapV5(async (req) => unwrap(await service.getCalendarDay({ ...req.query, date: req.params.date }, serviceAuth(req)))));
  router.post('/reservation-batches/precheck', requireAuth, wrapV5(async (req) => unwrap(await service.precheckReservation(req.body || {}, serviceAuth(req)))));
  router.post('/reservation-batches', requireAuth, wrapV5(async (req) => unwrap(await service.createReservation(req.body || {}, serviceAuth(req)))));
  router.get('/reservation-batches/me', requireAuth, wrapV5(async (req) => unwrap(await service.listReservationBatches(req.query || {}, serviceAuth(req)))));
  router.get('/reservation-batches/:id', requireAuth, wrapV5(async (req) => unwrap(await service.getReservationBatch({ ...req.query, id: req.params.id }, serviceAuth(req)))));
  router.patch('/reservation-items/:id/cancel', requireAuth, wrapV5(async (req) => unwrap(await service.cancelReservationItem({ ...req.body, id: req.params.id }, serviceAuth(req)))));
  router.patch('/admin/reservation-items/:id/cancel-review', requirePerm('reservation.approve'), validate({ body: z.object({ approved: z.boolean(), admin_note: z.string().max(500).optional() }).passthrough(), params: z.object({ id: z.string() }) }), wrapV5(async (req) => unwrap(await service.adminReviewReservationCancellation({ ...req.validated.body, id: req.validated.params.id }, serviceAuth(req)))));
  return router;
}

function createV5BorrowRouter(service) {
  const router = express.Router();
  router.get('/my-records', requireAuth, wrapV5(async (req) => unwrap(await service.myRecords(req.query || {}, serviceAuth(req)))));
  router.post('/borrow-records', requireAuth, wrapV5(async (req) => unwrap(await service.startUse(req.body || {}, serviceAuth(req)))));
  router.put('/borrow-records/:recordId/return', requireAuth, wrapV5(async (req) => unwrap(await service.submitReturn({ ...req.body, record_id: req.params.recordId }, serviceAuth(req)))));
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

function requireChatEventAuth() {
  return function (req, _res, next) {
    const token = String(req.query?.token || '').trim();
    const payload = verifyJwt(token, { type: 'access' });
    if (!payload) return next(new AppError('Unauthorized.', { status: 401, code: 1001 }));
    req.auth = payload;
    req.authToken = token;
    return next();
  };
}

function createV5ChatRouter(service) {
  const router = express.Router();
  router.get('/chat/events', requireChatEventAuth(), async (req, res, next) => {
    try {
      await service.streamChatEvents(req, res);
    } catch (error) {
      if (res.headersSent) return res.end();
      return next(error);
    }
  });
  router.use(requireAuth);
  router.get('/chat/users', wrapV5(async (req) => unwrap(await service.listChatUsers(req.query || {}, serviceAuth(req)))));
  router.get('/chat/conversations', wrapV5(async (req) => unwrap(await service.listChatConversations(req.query || {}, serviceAuth(req)))));
  router.post('/chat/conversations', wrapV5(async (req) => unwrap(await service.createChatConversation(req.body || {}, serviceAuth(req)))));
  router.post('/chat/conversations/:id/participants', wrapV5(async (req) => unwrap(await service.addChatParticipants({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  router.delete('/chat/conversations/:id/participants/:userId', wrapV5(async (req) => unwrap(await service.removeChatParticipant({ ...req.body, conversation_id: req.params.id, user_id: req.params.userId }, serviceAuth(req)))));
  router.post('/chat/conversations/:id/participants/:userId/remove', wrapV5(async (req) => unwrap(await service.removeChatParticipant({ ...req.body, conversation_id: req.params.id, user_id: req.params.userId }, serviceAuth(req)))));
  router.get('/chat/conversations/:id/messages', wrapV5(async (req) => unwrap(await service.listChatMessages({ ...req.query, conversation_id: req.params.id }, serviceAuth(req)))));
  router.post('/chat/conversations/:id/messages', wrapV5(async (req) => unwrap(await service.sendChatMessage({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  router.patch('/chat/conversations/:id/read', wrapV5(async (req) => unwrap(await service.markChatConversationRead({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  router.post('/chat/conversations/:id/leave', wrapV5(async (req) => unwrap(await service.leaveChatConversation({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  router.delete('/chat/conversations/:id', wrapV5(async (req) => unwrap(await service.dissolveChatConversation({ ...req.body, conversation_id: req.params.id }, serviceAuth(req)))));
  return router;
}

function createV5NotificationRouter(service) {
  const router = express.Router();
  router.use(requireAuth);
  router.get('/notifications', wrapV5(async (req) => unwrap(await service.listMyNotifications(req.query || {}, serviceAuth(req)))));
  router.patch('/notifications/read', wrapV5(async (req) => unwrap(await service.markMyNotificationsRead(req.body || {}, serviceAuth(req)))));
  return router;
}

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

function createV5Router(service, { refreshSessions, runtimeDiagnostics } = {}) {
  const router = express.Router();
  router.use(createV5AuthRouter(service, { refreshSessions }));
  router.use(createV5PublicSystemRouter(service));
  router.use(createV5DevicesRouter(service));
  router.use(createV5ReservationsRouter(service));
  router.use(createV5BorrowRouter(service));
  router.use(createV5ChatRouter(service));
  router.use(createV5NotificationRouter(service));
  router.use(createV5AdminRouter(service, { runtimeDiagnostics }));
  // v5 错误处理：中间件（如 requireAuth）抛出的 AppError 统一走 sendFail。
  router.use((err, req, res, _next) => {
    const { sendFail } = require('../../lib/v5-http');
    sendFail(res, err, req);
  });
  return router;
}

module.exports = { createV5Router, createV5AuthRouter, unwrap, serviceAuth };




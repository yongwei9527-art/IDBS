const express = require('express');
const { sendError, sendRest } = require('../lib/http');

function createRestApiRouter(service) {
  const router = express.Router();

  const wrap = (handler) => async (req, res) => {
    try {
      const result = await handler(req, res);
      return sendRest(res, result);
    } catch (error) {
      return sendError(res, error);
    }
  };

  router.post('/auth/login', wrap((req) => service.loginUser(req.body || {}, { deviceType: req.deviceType })));
  router.post('/auth/register', wrap((req) => service.registerUser(req.body || {})));
  router.post('/admin/auth/login', wrap((req) => service.adminLogin(req.body || {})));
  router.get('/login/challenge', wrap((req) => service.createLoginChallenge(req.query || {}, {
    deviceType: req.deviceType,
    ip: req.ip,
    host: req.headers.host,
    userAgent: req.headers['user-agent'],
    clientKey: req.headers['x-device-fingerprint'] || req.ip
  })));
  router.get('/login/status', wrap((req) => service.getLoginChallengeStatus(req.query || {}, {
    deviceType: req.deviceType,
    ip: req.ip,
    host: req.headers.host,
    userAgent: req.headers['user-agent'],
    clientKey: req.headers['x-device-fingerprint'] || req.ip
  })));
  router.post('/login/bind', wrap((req) => service.bindWechatAccount(req.body || {}, {
    deviceType: req.deviceType,
    ip: req.ip,
    host: req.headers.host,
    userAgent: req.headers['user-agent'],
    clientKey: req.headers['x-device-fingerprint'] || req.ip
  })));

  router.get('/users/profile', wrap((req) => service.getProfile(service.authTokenFromReq(req))));
  router.get('/system/notice', wrap(() => service.getSystemNotice()));
  router.get('/system/staff-contacts', wrap(() => service.getStaffContacts()));
  router.get('/notifications', wrap((req) => service.listMyNotifications(req.query || {}, service.authTokenFromReq(req))));
  router.patch('/notifications/read', wrap((req) => service.markMyNotificationsRead(req.body || {}, service.authTokenFromReq(req))));
  router.get('/chat/users', wrap((req) => service.listChatUsers(req.query || {}, service.authTokenFromReq(req))));
  router.get('/chat/conversations', wrap((req) => service.listChatConversations(req.query || {}, service.authTokenFromReq(req))));
  router.post('/chat/conversations', wrap((req) => service.createChatConversation(req.body || {}, service.authTokenFromReq(req))));
  router.post('/chat/conversations/:conversationId/participants', wrap((req) => service.addChatParticipants({
    ...req.body,
    conversation_id: req.params.conversationId
  }, service.authTokenFromReq(req))));
  router.delete('/chat/conversations/:conversationId/participants/:userId', wrap((req) => service.removeChatParticipant({
    ...(req.body || {}),
    conversation_id: req.params.conversationId,
    user_id: req.params.userId
  }, service.authTokenFromReq(req))));
  router.post('/chat/conversations/:conversationId/leave', wrap((req) => service.leaveChatConversation({
    ...(req.body || {}),
    conversation_id: req.params.conversationId
  }, service.authTokenFromReq(req))));
  router.post('/chat/conversations/:conversationId/participants/:userId/remove', wrap((req) => service.removeChatParticipant({
    ...(req.body || {}),
    conversation_id: req.params.conversationId,
    user_id: req.params.userId
  }, service.authTokenFromReq(req))));
  router.delete('/chat/conversations/:conversationId', wrap((req) => service.dissolveChatConversation({
    ...(req.body || {}),
    conversation_id: req.params.conversationId
  }, service.authTokenFromReq(req))));
  router.get('/chat/conversations/:conversationId/messages', wrap((req) => service.listChatMessages({
    ...req.query,
    conversation_id: req.params.conversationId
  }, service.authTokenFromReq(req))));
  router.post('/chat/conversations/:conversationId/messages', wrap((req) => service.sendChatMessage({
    ...req.body,
    conversation_id: req.params.conversationId
  }, service.authTokenFromReq(req))));
  router.patch('/chat/conversations/:conversationId/read', wrap((req) => service.markChatConversationRead({
    ...(req.body || {}),
    conversation_id: req.params.conversationId
  }, service.authTokenFromReq(req))));
  router.get('/chat/events', async (req, res) => {
    try {
      await service.streamChatEvents(req, res);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/reservation-slots', wrap((req) => service.getReservationSlotOptions(req.query || {})));
  router.get('/device-time-slots', wrap((req) => service.getDeviceTimeSlots(req.query || {})));
  router.get('/calendar', wrap((req) => service.getCalendarEvents(req.query || {}, service.authTokenFromReq(req))));
  router.get('/calendar/days/:date', wrap((req) => service.getCalendarDay({ ...req.query, date: req.params.date }, service.authTokenFromReq(req))));
  router.get('/devices', wrap((req) => service.listDevices(req.query || {})));
  router.get('/devices/:deviceCode', wrap((req) => service.getDeviceDetail({ deviceCode: req.params.deviceCode })));

  router.post('/bookings', wrap((req) => service.createReservation({
    ...(req.body || {}),
    device_codes: req.body?.device_codes || req.body?.deviceCodes || (req.body?.device_code || req.body?.deviceCode ? [req.body.device_code || req.body.deviceCode] : []),
    time_slots: req.body?.time_slots || req.body?.timeSlots || (req.body?.start_time && req.body?.end_time ? [`${req.body.start_time} - ${req.body.end_time}`] : [])
  }, service.authTokenFromReq(req))));
  router.post('/bookings/precheck', wrap((req) => service.precheckReservation(req.body || {}, service.authTokenFromReq(req))));
  router.get('/bookings/me', wrap((req) => service.myRecords(req.query || {}, service.authTokenFromReq(req))));
  router.post('/reservation-batches', wrap((req) => service.createReservation(req.body || {}, service.authTokenFromReq(req))));
  router.post('/reservation-batches/precheck', wrap((req) => service.precheckReservation(req.body || {}, service.authTokenFromReq(req))));
  router.get('/reservation-batches/me', wrap((req) => service.listReservationBatches(req.query || {}, service.authTokenFromReq(req))));
  router.get('/reservation-batches/:id', wrap((req) => service.getReservationBatch({ ...req.query, id: req.params.id }, service.authTokenFromReq(req))));
  router.patch('/reservation-items/:id/cancel', wrap((req) => service.cancelReservationItem({ ...req.body, id: req.params.id }, service.authTokenFromReq(req))));
  router.patch('/bookings/:reservationId/cancel', wrap((req) => service.cancelReservation({
    ...req.body,
    reservation_id: req.params.reservationId
  }, service.authTokenFromReq(req))));

  router.post('/borrow-records', wrap((req) => service.startUse(req.body || {}, service.authTokenFromReq(req))));
  router.put('/borrow-records/:recordId/return', wrap((req) => service.submitReturn({
    ...req.body,
    record_id: req.params.recordId
  }, service.authTokenFromReq(req))));
  router.post('/fault-reports', wrap((req) => service.reportDeviceFault(req.body || {}, service.authTokenFromReq(req))));
  router.get('/user-requests', wrap((req) => service.listMyUserRequests(req.query || {}, service.authTokenFromReq(req))));
  router.post('/user-requests', wrap((req) => service.createUserRequest(req.body || {}, service.authTokenFromReq(req))));
  router.put('/user-requests/:requestId', wrap((req) => service.updateUserRequest({
    ...req.body,
    request_id: req.params.requestId
  }, service.authTokenFromReq(req))));
  router.patch('/user-requests/:requestId/cancel', wrap((req) => service.cancelUserRequest({
    ...req.body,
    request_id: req.params.requestId
  }, service.authTokenFromReq(req))));
  router.post('/user-requests/:requestId/change-request', wrap((req) => service.requestUserRequestChange({
    ...req.body,
    request_id: req.params.requestId
  }, service.authTokenFromReq(req))));

  router.get('/admin/users', wrap((req) => service.adminListUsers(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/users/:userId/detail', wrap((req) => service.adminGetUserDetail({
    ...req.query,
    user_id: req.params.userId
  }, service.authTokenFromReq(req))));
  router.delete('/admin/users/:userId', wrap((req) => service.adminDeleteUser({
    ...req.body,
    user_id: req.params.userId
  }, service.authTokenFromReq(req))));
  router.put('/admin/users/:userId/status', wrap((req) => service.adminSetUserStatus({
    ...req.body,
    user_id: req.params.userId
  }, service.authTokenFromReq(req))));
  router.put('/admin/users/:userId/ban', wrap((req) => service.adminSetUserBan({
    ...req.body,
    user_id: req.params.userId
  }, service.authTokenFromReq(req))));
  router.delete('/admin/users/:userId/wechat-binding', wrap((req) => service.adminUnbindWechat({
    ...req.body,
    user_id: req.params.userId
  }, service.authTokenFromReq(req))));

  router.post('/admin/devices', wrap((req) => service.adminCreateDevice(req.body || {}, service.authTokenFromReq(req))));
  router.get('/admin/devices', wrap((req) => service.adminListDevices(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/devices/:deviceId/detail', wrap((req) => service.adminGetDeviceDetail({
    ...req.query,
    device_id: req.params.deviceId
  }, service.authTokenFromReq(req))));
  router.put('/admin/devices/:deviceId', wrap((req) => service.adminUpdateDevice({
    ...req.body,
    id: req.params.deviceId
  }, service.authTokenFromReq(req))));
  router.put('/admin/devices/:deviceId/availability', wrap((req) => service.adminSetDeviceAvailable({
    ...req.body,
    device_id: req.params.deviceId
  }, service.authTokenFromReq(req))));

  router.get('/admin/bookings', wrap((req) => service.adminListReservations(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/reservation-batches', wrap((req) => service.adminListReservationBatches(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/reservation-batches/:id', wrap((req) => service.adminGetReservationBatch({ ...req.query, id: req.params.id }, service.authTokenFromReq(req))));
  router.patch('/admin/reservation-batches/:id/approval', wrap((req) => service.adminApproveReservationBatch({ ...req.body, id: req.params.id }, service.authTokenFromReq(req))));
  router.patch('/admin/reservation-items/:id/approval', wrap((req) => service.adminApproveReservation({ ...req.body, reservation_id: req.params.id }, service.authTokenFromReq(req))));
  router.patch('/admin/bookings/:reservationId/approval', wrap((req) => service.adminApproveReservation({
    ...req.body,
    reservation_id: req.params.reservationId
  }, service.authTokenFromReq(req))));

  router.get('/admin/security-config', wrap((req) => service.adminGetSecurityConfig(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/dashboard', wrap((req) => service.adminDashboard(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/analytics/overview', wrap((req) => service.adminAnalyticsOverview(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/analytics/device-usage', wrap((req) => service.adminAnalyticsDeviceUsage(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/analytics/time-heatmap', wrap((req) => service.adminAnalyticsTimeHeatmap(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/analytics/faults', wrap((req) => service.adminAnalyticsFaults(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/permissions', wrap((req) => service.adminPermissions(req.query || {}, service.authTokenFromReq(req))));
  router.put('/admin/user-roles', wrap((req) => service.adminUserRoles(req.body || {}, service.authTokenFromReq(req))));
  router.get('/admin/operation-logs', wrap((req) => service.adminOperationLogs(req.query || {}, service.authTokenFromReq(req))));
  router.put('/admin/security-config', wrap((req) => service.adminUpdateSecurityConfig(req.body || {}, service.authTokenFromReq(req))));
  router.get('/admin/activity-summary', wrap((req) => service.adminGetActivitySummary(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/roles', wrap((req) => service.adminListRoles(req.query || {}, service.authTokenFromReq(req))));
  router.put('/admin/roles', wrap((req) => service.adminUpsertRole(req.body || {}, service.authTokenFromReq(req))));
  router.delete('/admin/roles', wrap((req) => service.adminRevokeRole(req.body || {}, service.authTokenFromReq(req))));
  router.get('/admin/reports/daily-usage', wrap((req) => service.adminPreviewDailyUsageReport(req.query || {}, service.authTokenFromReq(req))));
  router.post('/admin/reports/daily-usage/send', wrap((req) => service.adminSendDailyUsageReport(req.body || {}, service.authTokenFromReq(req))));
  router.get('/admin/statistics/usage', wrap((req) => service.usageStats(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/exports/:type', wrap((req) => service.adminExportData({
    ...req.query,
    type: req.params.type
  }, service.authTokenFromReq(req))));
  router.get('/admin/export-jobs', wrap((req) => service.adminListExportJobs(req.query || {}, service.authTokenFromReq(req))));
  router.post('/admin/export-jobs', wrap((req) => service.adminCreateExportJob(req.body || {}, service.authTokenFromReq(req))));
  router.post('/admin/export-jobs/run-next', wrap((req) => service.adminRunNextExportJob(req.body || {}, service.authTokenFromReq(req))));
  router.get('/admin/options', wrap((req) => service.adminOptions(req.query || {}, service.authTokenFromReq(req))));
  router.get('/admin/fault-reports', wrap((req) => service.adminListFaultReports(req.query || {}, service.authTokenFromReq(req))));
  router.patch('/admin/fault-reports/:reportId', wrap((req) => service.adminResolveFaultReport({
    ...req.body,
    report_id: req.params.reportId
  }, service.authTokenFromReq(req))));
  router.get('/admin/user-requests', wrap((req) => service.adminListUserRequests(req.query || {}, service.authTokenFromReq(req))));
  router.patch('/admin/user-requests/:requestId/review', wrap((req) => service.adminReviewUserRequest({
    ...req.body,
    request_id: req.params.requestId
  }, service.authTokenFromReq(req))));

  return router;
}

module.exports = { createRestApiRouter };

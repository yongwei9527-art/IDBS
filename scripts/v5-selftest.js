const express = require('express');
const { createV5Router } = require('../src/routes/v5');
const { issueJwt } = require('../src/lib/auth');

let lastAdminFaultParams;
const s = {
  loginUser: async () => ({ ok: true, data: { user: { id: 'u1', name: 'a' }, role: 'user', permissions: ['r.v', 'stats.view', 'stats.export', 'user.manage', 'reservation.view', 'reservation.approve', 'device.view', 'device.manage'] } }),
  getProfile: async () => ({ ok: true, data: { id: 'u1', name: 'a', role: 'user', permissions: ['r.v', 'stats.view', 'stats.export', 'user.manage', 'reservation.view', 'reservation.approve', 'device.view', 'device.manage'] } }),
  getSystemNotice: async () => ({ ok: true, data: { notice: { enabled: true, title: '使用注意事项', content: '请按预约时间使用设备。', version: 'test' } } }),
  getStaffContacts: async () => ({ ok: true, data: { contacts: [{ name: '管理员', phone: '13800000000', enabled: true }] } }),
  createLoginChallenge: async () => ({ ok: true, data: { code: '12345', expire_minutes: 3 } }),
  getLoginChallengeStatus: async () => ({ ok: true, data: { logged_in: false, need_bind: true, status: 'need_bind', temp_code: '12345', openid_masked: 'wxid...test' } }),
  bindWechatAccount: async () => ({ ok: true, data: { message: '注册与绑定已完成，请等待管理员审核。', need_review: true, user: { id: 'u2', name: '新用户' } } }),
  adminDashboard: async () => ({ ok: true, data: { kpi: { pending_reservations: 1 }, device_status: { available: 2 } } }),
  adminAnalyticsOverview: async () => ({ ok: true, data: { range: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-05T23:59:59.000Z' }, trend: [{ day: '2026-07-05', reservation_count: 1, borrow_count: 1, return_count: 1, fault_count: 1 }], device_status: [{ status: 'available', count: 1 }], approvals: [{ status: 'pending', count: 1 }] } }),
  adminAnalyticsDeviceUsage: async () => ({ ok: true, data: { metric: 'borrow_count', rows: [{ device_code: 'R200', name: '测试设备', borrow_count: 1, reservation_count: 1, total_minutes: 60, fault_count: 0 }] } }),
  adminAnalyticsTimeHeatmap: async () => ({ ok: true, data: { range: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-05T23:59:59.000Z' }, rows: [{ weekday: 1, slot_key: 'morning', count: 1 }] } }),
  adminAnalyticsFaults: async () => ({ ok: true, data: { range: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-05T23:59:59.000Z' }, trend: [{ day: '2026-07-05', count: 1 }], types: [{ issue_type: 'device_fault', count: 1 }], devices: [{ device_code: 'R200', device_name: '测试设备', count: 1 }] } }),
  adminAnalyticsIntelligence: async () => ({
    ok: true,
    data: {
      generated_at: '2026-07-05T00:00:00.000Z',
      range: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-05T23:59:59.000Z' },
      summary: { risk_devices: 1, high_demand_slots: 1, overdue_or_abnormal: 1, pending_workload: 3, low_utilization_devices: 1 },
      ops_briefing: '运营简报：当前健康分 72，需要关注。',
      health_summary: { score: 72, level: 'watch', label: '需要关注', narrative: '优先处理待办。', signals: [{ key: 'pending_workload', label: '待处理工作量', value: 3, tone: 'warning' }] },
      action_groups: [{ key: 'today', label: '今日收口', description: '当天完成的事项', count: 1, actions: [{ id: 'rec1', group: 'today', level: 'warning', type: 'approval_workload', title: '今日待办', description: '处理待办', action_label: '去处理', action_url: '/admin/reservations?status=pending', estimated_impact: '缩短等待', execution_status: 'open', execution_note: '' }] }],
      next_actions: [{ id: 'rec1', group: 'today', level: 'warning', type: 'approval_workload', title: '今日待办', description: '处理待办', action_label: '去处理', action_url: '/admin/reservations?status=pending', estimated_impact: '缩短等待', execution_status: 'open', execution_note: '' }],
      role_focus: [{ role_key: 'reservation_admin', label: '预约管理员', focus: '优先处理预约审批', highlights: ['预约审批 1'], action_url: '/admin/reservations?status=pending' }],
      recommendations: [{ id: 'rec1', level: 'warning', type: 'fault_risk', title: '恒温培养箱风险较高', description: '近期故障和异常归还集中。', evidence: ['风险分 75', '故障 2 次'], action_label: '查看故障', action_url: '/admin/faults?status=pending&device_code=R200' }, { id: 'rec2', level: 'info', type: 'peak_demand', title: '上午预约高峰', description: '建议提前协调排班。', evidence: ['周一 上午'], action_label: '查看高峰', action_url: '/admin/stats?range=30d&focus=peak-slot' }, { id: 'rec3', level: 'warning', type: 'approval_workload', title: '待办工作需要收口', description: '优先处理待审批预约。', evidence: ['待审预约 1'], action_label: '处理预约', action_url: '/admin/reservations?status=pending' }, { id: 'rec4', level: 'success', type: 'low_utilization', title: '低频设备可优化', description: '优化展示或培训。', evidence: ['R201'], action_label: '查看设备', action_url: '/admin/devices?device_code=R201' }],
      device_risks: [{ device_code: 'R200', device_name: '测试设备', risk_score: 75, fault_count: 2, abnormal_return_count: 1, usage_count: 8, status: 'maintenance', suggestion: '建议维护' }],
      demand_forecast: [{ weekday: 1, slot_key: 'morning', count: 5, level: 'high' }],
      workload: { pending_reservations: 1, pending_users: 1, pending_faults: 1, overdue_borrows: 0 },
      low_utilization_devices: [{ device_code: 'R201', device_name: '低频设备', usage_count: 0, reservation_count: 1, status: 'available' }]
    }
  }),
  adminListIntelligenceActionLogs: async () => ({ ok: true, data: { logs: [{ id: 'ial1', action_id: 'rec1', action_type: 'approval_workload', action_title: '今日待办', status: 'done', note: '已处理', handled_by_name: 'a', handled_at: '2026-07-05T01:00:00.000Z' }], persisted: true } }),
  adminUpdateIntelligenceAction: async (payload = {}) => ({ ok: true, data: { action: { id: 'ial2', action_id: payload.action_id, action_type: payload.action_type, action_title: payload.action_title, status: payload.status || 'done', note: payload.note || '', handled_by_name: 'a', handled_at: '2026-07-05T02:00:00.000Z', persisted: true } } }),
  adminExportData: async (payload = {}) => ({ ok: true, data: { type: payload.type || 'usage', rows: [{ device_code: 'R200', device_name: '测试设备', user_name: 'a', borrow_time: '2026-07-05T08:00:00.000Z', return_time: '2026-07-05T09:00:00.000Z', duration_minutes: 60 }] } }),
  adminListUsers: async () => ({ ok: true, data: { users: [{ id: 'u2', name: '新用户', phone: '13800000002', student_no: 'S1', role: 'user', status: 'pending', disabled_reason: '', wechat_bound: true, wechat_nickname: '微信用户', wechat_openid_masked: 'wxid...test', is_banned: false, created_at: new Date().toISOString() }] } }),
  adminGetUserDetail: async () => ({ ok: true, data: { user: { id: 'u2', name: '新用户', phone: '13800000002', student_no: 'S1', role: 'user', status: 'pending', disabled_reason: '', wechat_bound: true }, reservations: [], borrows: [], fault_reports: [], requests: [], activity: [] } }),
  adminSetUserStatus: async (payload = {}) => {
    if (payload.status === 'rejected' && !String(payload.reason || payload.admin_note || '').trim()) return { ok: false, status: 400, code: 2001, message: 'Reject reason is required' };
    return { ok: true, data: { message: 'User status updated', status: payload.status, reason: payload.reason || payload.admin_note || '' } };
  },
  adminSetUserBan: async () => ({ ok: true, data: { message: 'User banned' } }),
  adminUnbindWechat: async () => ({ ok: true, data: { message: 'WeChat binding removed' } }),
  adminDeleteUser: async () => ({ ok: true, data: { message: 'User deleted', soft_deleted: false, linked_count: 0 } }),
  adminGetSecurityConfig: async () => ({ ok: true, data: { config: { captcha_expire_minutes: 3, captcha_hourly_limit: 3, staff_contacts: [] } } }),
  adminUpdateSecurityConfig: async () => ({ ok: true, data: { message: 'ok', config: { captcha_expire_minutes: 5 } } }),
  adminGetActivitySummary: async () => ({ ok: true, data: { summary: { registered_today: 1, logged_in_today: 2 }, rows: [] } }),
  adminPreviewDailyUsageReport: async () => ({ ok: true, data: { date: '2026-07-05', message: '日报预览\n智能运营解读', intelligence_summary: { risk_devices: 1, high_demand_slots: 1, pending_workload: 3, overdue_or_abnormal: 1, today_reservations: 2 }, smart_insights: { recommendations: [{ id: 'daily-rec', title: '待处理工作需要收口', description: '优先处理故障和逾期。' }] } } }),
  adminSendDailyUsageReport: async () => ({ ok: true, data: { sent: 1, failed: 0, message: '日报已发送\n智能运营解读', intelligence_summary: { risk_devices: 1, high_demand_slots: 1, pending_workload: 3, overdue_or_abnormal: 1 }, smart_insights: { recommendations: [{ id: 'daily-rec', title: '待处理工作需要收口', description: '优先处理故障和逾期。' }] } } }),
  adminOperationLogs: async () => ({ ok: true, data: { logs: [{ id: 'op1', operator_name: 'audit admin', action: 'export_faults', target_type: 'export', detail: { permission: 'stats.view' }, created_at: '2026-07-05T01:00:00.000Z' }], total: 1, has_more: false } }),
  adminListRoles: async () => ({ ok: true, data: { roles: [], permissions: [], role_defaults: {} } }),
  listDevices: async () => ({ ok: true, data: { devices: [{ id: 'd1', device_code: 'R200', name: '测试设备', status: 'available' }] } }),
  getDeviceDetail: async () => ({ ok: true, data: { device: { id: 'd1', device_code: 'R200', name: '测试设备', status: 'available', last_return_time: '2026-07-05T09:00:00.000Z', last_condition: '正常' }, reservations: [{ id: 'ri1', start_time: '2026-07-06T08:00:00.000Z', end_time: '2026-07-06T12:00:00.000Z', status: 'approved', purpose: '培训', user_name: '新用户' }], occupancy_14_days: [{ id: 'ri1', start_time: '2026-07-06T08:00:00.000Z', end_time: '2026-07-06T12:00:00.000Z', status: 'approved', purpose: '培训' }], recent_fault_reports: [{ id: 'f1', issue_type: 'device_fault', status: 'pending', description: '异常', created_at: '2026-07-05T08:00:00.000Z' }], current_borrow: { id: 'br1', user_name: '新用户', borrow_time: '2026-07-05T10:00:00.000Z', status: 'in_use' }, next_reservation: { id: 'ri1', start_time: '2026-07-06T08:00:00.000Z', end_time: '2026-07-06T12:00:00.000Z', status: 'approved' } } }),
  adminListDevices: async () => ({ ok: true, data: { list: [{ id: 'd1', device_code: 'R200', name: '测试设备', status: 'available', allow_reservation: true, reservation_slot_options: [{ key: 'morning', label: '上午', start: '08:00', end: '12:00' }] }], total: 1 } }),
  adminCreateDevice: async () => ({ ok: true, data: { message: 'Device created', device: { id: 'd2', device_code: 'R201', name: '新设备', status: 'available' } } }),
  adminUpdateDevice: async () => ({ ok: true, data: { message: 'Device updated' } }),
  adminGetDeviceDetail: async () => ({ ok: true, data: { device: { id: 'd1', device_code: 'R200', name: '测试设备', status: 'available' }, reservations: [], borrows: [], fault_reports: [] } }),
  adminSetDeviceAvailable: async () => ({ ok: true, data: { message: 'Device is available again' } }),
  getReservationSlotOptions: async () => ({ ok: true, data: [{ key: 'morning', label: '上午', start: '08:00', end: '12:00' }] }),
  precheckReservation: async () => ({ ok: true, data: { ok: true, conflicts: [] } }),
  createReservation: async () => ({ ok: true, data: { id: 'b1', status: 'pending', device_codes: 'R200', time_slots: 'morning', created_at: new Date().toISOString() } }),
  listReservationBatches: async () => ({ ok: true, data: { batches: [{ id: 'b1', status: 'pending', device_codes: 'R200', time_slots: 'morning', created_at: new Date().toISOString() }] } }),
  getReservationBatch: async () => ({ ok: true, data: { batch: { id: 'b1', status: 'approved', device_codes: 'R200', created_at: new Date().toISOString() }, items: [{ id: 'ri1', item_id: 'ri1', batch_id: 'b1', device_id: 'd1', device_code: 'R200', device_name: '测试设备', reservation_date: '2026-07-06', slot_key: 'morning', start_time: '2026-07-06T08:00:00.000Z', end_time: '2026-07-06T12:00:00.000Z', status: 'approved' }] } }),
  cancelReservationItem: async () => ({ ok: true, data: { message: '预约已取消。' } }),
  myRecords: async () => ({ ok: true, data: { reservations: [{ id: 'ri1', item_id: 'ri1', device_id: 'd1', device_code: 'R200', device_name: '测试设备', reservation_date: '2026-07-06', slot_key: 'morning', start_time: '2026-07-06T08:00:00.000Z', end_time: '2026-07-06T12:00:00.000Z', status: 'approved', can_cancel: true }], borrows: [{ id: 'br1', device_id: 'd1', device_code: 'R200', device_name: '测试设备', borrow_time: new Date().toISOString(), expected_return_time: new Date().toISOString(), status: 'in_use' }], require_return_photo: false } }),
  getCalendarEvents: async () => ({ ok: true, data: { server_today: '2026-07-05', events: [{ event_id: 'e1', device_id: 'd1', device_code: 'R200', device_name: '测试设备', user_id: 'u2', user_name: '新用户', user_phone: '13800000002', purpose: '培训', start_time: '2026-07-05T08:00:00.000Z', end_time: '2026-07-05T12:00:00.000Z', status: 'approved', source_type: 'reservation' }] } }),
  getCalendarDay: async () => ({ ok: true, data: { events: [{ event_id: 'e1', device_id: 'd1', device_code: 'R200', device_name: '测试设备', user_id: 'u2', user_name: '新用户', user_phone: '13800000002', purpose: '培训', start_time: '2026-07-05T08:00:00.000Z', end_time: '2026-07-05T12:00:00.000Z', status: 'approved', source_type: 'reservation' }] } }),
  adminListReservationBatches: async () => ({ ok: true, data: { batches: [{ id: 'b1', status: 'pending', item_count: 1 }] } }),
  adminGetReservationBatch: async () => ({
    ok: true,
    data: {
      batch: { id: 'b1', status: 'pending', user_name: '测试用户', user_phone: '13800000001' },
      items: [{
        id: 'ri1',
        item_id: 'ri1',
        device_id: 'd1',
        device_code: 'R200',
        device_name: '测试设备',
        start_time: '2026-07-06T08:00:00.000Z',
        end_time: '2026-07-06T12:00:00.000Z',
        slot_key: 'morning',
        status: 'pending'
      }],
      approval_risk: {
        safe: true,
        level: 'safe',
        action: 'approve',
        action_label: '低风险，可通过',
        risk_score: 0,
        confidence: 70,
        signal_counts: { danger: 0, warning: 0, info: 0 },
        summary: '智能审批建议：低风险，可通过。未发现明显冲突，可安全审批。',
        recommendation: '未发现设备占用、状态异常或用户未完成借用；可按常规流程通过。',
        items: []
      },
      approval_logs: []
    }
  }),
  adminApproveReservationBatch: async () => ({ ok: true, data: { id: 'b1', status: 'approved' } }),
  adminApproveReservation: async () => ({ ok: true, data: { message: '已通过预约' } }),
  adminChangeReservationPlan: async () => ({ ok: true, data: { message: '预约计划已调整。' } }),
  startUse: async () => ({ ok: true, data: { id: 'br1', device_id: 'd1', device_code: 'R200', borrow_time: new Date().toISOString(), status: 'in_use' } }),
  submitReturn: async () => ({ ok: true, data: { id: 'br1', device_id: 'd1', device_code: 'R200', borrow_time: new Date().toISOString(), return_time: new Date().toISOString(), status: 'returned' } }),
  reportDeviceFault: async () => ({ ok: true, data: { id: 'f1', device_id: 'd1', issue_type: 'device_fault', severity: 'high', description: '异常', photos: ['/uploads/fault.png'], status: 'pending' } }),
  listMyFaultReports: async () => ({ ok: true, data: { reports: [{ id: 'f1', device_id: 'd1', device_code: 'R200', device_name: '测试设备', issue_type: 'device_fault', severity: 'high', description: '异常', photos: ['/uploads/fault.png'], status: 'pending', admin_note: '', created_at: new Date().toISOString() }] } }),
  adminListFaultReports: async (params = {}) => { lastAdminFaultParams = params; return { ok: true, data: { reports: [{ id: 'f1', device_id: 'd1', device_code: 'R200', device_name: '测试设备', device_location: 'A101', user_id: 'u1', user_name: 'a', user_phone: '13800000001', issue_type: 'device_fault', severity: 'high', description: '异常', photos: ['/uploads/fault.png'], status: 'pending', admin_note: '待检查', created_at: new Date().toISOString() }] } }; },
  adminResolveFaultReport: async (payload = {}) => {
    if (!payload.report_id || !payload.status || !payload.admin_note) return { ok: false, status: 400, code: 2001, message: 'missing fault resolve payload' };
    return { ok: true, data: { message: '故障状态已更新。', report_id: payload.report_id, status: payload.status, admin_note: payload.admin_note, set_available: !!payload.set_available, keep_maintenance: !!payload.keep_maintenance } };
  },
  listMyUserRequests: async () => ({ ok: true, data: { requests: [{ id: 'ur1', user_id: 'u1', title: '希望增加夜间预约说明', description: '夜间设备使用注意事项需要更清楚。', category: 'feature', priority: 'normal', status: 'pending', device_code: 'R200', created_at: new Date().toISOString() }] } }),
  createUserRequest: async () => ({ ok: true, data: { message: '需求已提交', request: { id: 'ur2', title: '新增诉求', status: 'pending' } } }),
  updateUserRequest: async () => ({ ok: true, data: { message: '需求已更新' } }),
  cancelUserRequest: async () => ({ ok: true, data: { message: '需求已撤回' } }),
  requestUserRequestChange: async () => ({ ok: true, data: { message: '修改申请已提交' } }),
  adminListUserRequests: async () => ({ ok: true, data: { requests: [{ id: 'ur1', user_id: 'u1', user_name: 'a', user_phone: '13800000001', title: '希望增加夜间预约说明', description: '夜间设备使用注意事项需要更清楚。', category: 'feature', priority: 'normal', status: 'change_requested', change_request_note: '想补充设备背景', device_code: 'R200', created_at: new Date().toISOString() }] } }),
  adminReviewUserRequest: async () => ({ ok: true, data: { message: '需求状态已更新' } }),
  listMyNotifications: async () => ({ ok: true, data: { notifications: [{ id: 'n1', type: 'reservation', title: '预约通知', content: '已提交', level: 'info', is_read: false, created_at: new Date().toISOString() }] } }),
  markMyNotificationsRead: async () => ({ ok: true, data: { updated: 1 } }),
  listChatUsers: async () => ({ ok: true, data: { users: [{ id: 'u2', name: '新用户', phone: '13800000002', student_no: 'S1', role: 'user' }, { id: 'u3', name: '组员', phone: '13800000003', student_no: 'S2', role: 'user' }] } }),
  listChatConversations: async () => ({ ok: true, data: { conversations: [{ id: 'c1', type: 'group', title: '实验管理群', created_by: 'u1', participants: [{ id: 'u1', name: 'a', participant_role: 'owner' }, { id: 'u2', name: '新用户', participant_role: 'member' }], unread_count: 1, last_message_preview: '欢迎', last_message_at: new Date().toISOString() }] } }),
  createChatConversation: async () => ({ ok: true, data: { conversation: { id: 'c2', type: 'group', title: '新群聊', created_by: 'u1', participants: [] } } }),
  addChatParticipants: async () => ({ ok: true, data: { conversation: { id: 'c1', type: 'group', title: '实验管理群' }, added_count: 1 } }),
  removeChatParticipant: async () => ({ ok: true, data: { conversation: { id: 'c1', type: 'group', title: '实验管理群' } } }),
  leaveChatConversation: async () => ({ ok: true, data: { left: true, conversation_id: 'c1' } }),
  dissolveChatConversation: async () => ({ ok: true, data: { deleted: true, conversation_id: 'c1' } }),
  listChatMessages: async () => ({ ok: true, data: { conversation: { id: 'c1', type: 'group', title: '实验管理群', created_by: 'u1', participants: [{ id: 'u1', name: 'a', participant_role: 'owner' }, { id: 'u2', name: '新用户', participant_role: 'member' }] }, current_user: { id: 'u1', name: 'a', role: 'user', can_announce: true, can_kick: true }, messages: [{ id: 'm1', conversation_id: 'c1', sender_id: 'u1', message_type: 'text', content: '你好', created_at: new Date().toISOString() }] } }),
  sendChatMessage: async (payload = {}) => ({ ok: true, data: { message: { id: 'm2', conversation_id: 'c1', sender_id: 'u1', message_type: payload.message_type || 'text', content: payload.content || '收到', attachments: payload.attachments || [], metadata: payload.metadata || {}, related_type: payload.related_type || '', related_id: payload.related_id || '', created_at: new Date().toISOString() } } }),
  markChatConversationRead: async () => ({ ok: true, data: { ok: true } }),
  streamChatEvents: async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.write('event: ready\n');
    res.write('data: {"server_time":"2026-07-05T00:00:00.000Z"}\n\n');
    res.end();
  }
};
const app = express();
app.use(express.json());
app.use('/api/v5', createV5Router(s, {
  bridge: () => 'tok',
  refreshSessions: {
    createRefreshSession: async () => true,
    rotateRefreshSession: async () => true,
    revokeRefreshSession: async () => true
  }
}));
const srv = require('http').createServer(app).listen(0, async () => {
  const u = 'http://127.0.0.1:' + srv.address().port;
  const r3 = await fetch(u + '/api/v5/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '13800000001', password: '123456' }) });
  const j3 = (await r3.json()).data;
  if (j3.refresh_token) throw new Error('refresh token must not be exposed in the login response');
  const refreshCookie = String(r3.headers.get('set-cookie') || '').split(';')[0];
  if (!refreshCookie.startsWith('idbs.refresh_token=')) throw new Error('login did not set the HttpOnly refresh cookie');
  const refreshResponse = await fetch(u + '/api/v5/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: refreshCookie },
    body: '{}'
  });
  if (refreshResponse.status !== 200 || !String(refreshResponse.headers.get('set-cookie') || '').includes('HttpOnly')) {
    throw new Error('refresh token rotation did not return a renewed HttpOnly cookie');
  }
  const tok = j3.access_token;
  const noApprovalTok = issueJwt({ sub: 'admin-no-approval', scope: 'admin', role: 'admin', perms: ['reservation.view', 'stats.view', 'device.view'], name: 'no approval admin' }, { type: 'access' });
  const noExportTok = issueJwt({ sub: 'admin-no-export', scope: 'admin', role: 'admin', perms: ['stats.view', 'device.view'], name: 'no export admin' }, { type: 'access' });
  const faultExportTok = issueJwt({ sub: 'admin-fault-export', scope: 'admin', role: 'admin', perms: ['stats.export', 'fault.manage'], name: 'fault export admin' }, { type: 'access' });
  const auditExportTok = issueJwt({ sub: 'admin-audit-export', scope: 'admin', role: 'admin', perms: ['audit.view', 'stats.export'], name: 'audit export admin' }, { type: 'access' });
  const statsOnlyTok = issueJwt({ sub: 'admin-stats-only', scope: 'admin', role: 'admin', perms: ['stats.view'], name: 'stats only admin' }, { type: 'access' });
  const requestReadonlyTok = issueJwt({ sub: 'admin-request-readonly', scope: 'admin', role: 'admin', perms: ['reservation.view', 'stats.view'], name: 'request readonly admin' }, { type: 'access' });
  const auditTok = issueJwt({ sub: 'admin-audit', scope: 'admin', role: 'admin', perms: ['audit.view'], name: 'audit admin' }, { type: 'access' });
  const userApproveTok = issueJwt({ sub: 'admin-user-approve', scope: 'admin', role: 'admin', perms: ['user.approve'], name: 'user approval admin' }, { type: 'access' });
  const changePlanTok = issueJwt({ sub: 'admin-change-plan', scope: 'admin', role: 'admin', perms: ['reservation.view', 'reservation.change_plan'], name: 'change plan admin' }, { type: 'access' });
  const reservationApproveTok = issueJwt({ sub: 'admin-reservation-approve', scope: 'admin', role: 'admin', perms: ['reservation.approve'], name: 'reservation approval admin' }, { type: 'access' });
  const returnConfirmTok = issueJwt({ sub: 'admin-return-confirm', scope: 'admin', role: 'admin', perms: ['return.confirm'], name: 'return confirmation admin' }, { type: 'access' });
  const r4 = await fetch(u + '/api/v5/me', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/me', r4.status, await r4.text());
  const r5 = await fetch(u + '/api/v5/me', { headers: { Authorization: 'Bearer bad', Accept: 'application/problem+json' } });
  console.log('/me problem', r5.status, 'ct=', r5.headers.get('content-type'));
  const r7 = await fetch(u + '/api/v5/admin/dashboard', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/dashboard', r7.status, await r7.text());
  const r7AuditDashboard = await fetch(u + '/api/v5/admin/dashboard', { headers: { Authorization: 'Bearer ' + auditTok } });
  console.log('/admin/dashboard audit.view', r7AuditDashboard.status, await r7AuditDashboard.text());
  if (r7AuditDashboard.status !== 200) {
    throw new Error('admin with audit.view should be able to access the permission-aware dashboard');
  }
  const r7UserApprovalDashboard = await fetch(u + '/api/v5/admin/dashboard', { headers: { Authorization: 'Bearer ' + userApproveTok } });
  console.log('/admin/dashboard user.approve', r7UserApprovalDashboard.status, await r7UserApprovalDashboard.text());
  if (r7UserApprovalDashboard.status !== 200) {
    throw new Error('admin with user.approve should be able to access the permission-aware dashboard');
  }
  const r7g = await fetch(u + '/api/v5/admin/analytics/overview?range=7d', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/analytics/overview', r7g.status, await r7g.text());
  const r7h = await fetch(u + '/api/v5/admin/analytics/device-usage?metric=borrow_count', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/analytics/device-usage', r7h.status, await r7h.text());
  const r7i = await fetch(u + '/api/v5/admin/analytics/time-heatmap?range=7d', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/analytics/time-heatmap', r7i.status, await r7i.text());
  const r7j = await fetch(u + '/api/v5/admin/analytics/faults?range=7d', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/analytics/faults', r7j.status, await r7j.text());
  const r7k = await fetch(u + '/api/v5/admin/analytics/intelligence?range=30d', { headers: { Authorization: 'Bearer ' + tok } });
  const r7kText = await r7k.text();
  console.log('/admin/analytics/intelligence', r7k.status, r7kText);
  const r7kData = JSON.parse(r7kText).data || {};
  if (
    r7k.status !== 200 ||
    !r7kData.summary ||
    !Array.isArray(r7kData.recommendations) ||
    !Array.isArray(r7kData.device_risks) ||
    !Array.isArray(r7kData.demand_forecast) ||
    !r7kData.ops_briefing ||
    !r7kData.health_summary ||
    !Array.isArray(r7kData.action_groups) ||
    !Array.isArray(r7kData.next_actions) ||
    !Array.isArray(r7kData.role_focus) ||
    r7kData.next_actions.some((item) => !item.execution_status)
  ) {
    throw new Error('/admin/analytics/intelligence missing smart operations payload');
  }
  const r7kActions = await fetch(u + '/api/v5/admin/analytics/intelligence/actions?action_id=rec1', { headers: { Authorization: 'Bearer ' + tok } });
  const r7kActionsText = await r7kActions.text();
  console.log('/admin/analytics/intelligence/actions', r7kActions.status, r7kActionsText);
  const r7kActionsData = JSON.parse(r7kActionsText).data || {};
  if (r7kActions.status !== 200 || !Array.isArray(r7kActionsData.logs)) {
    throw new Error('/admin/analytics/intelligence/actions missing action logs payload');
  }
  const r7kPatch = await fetch(u + '/api/v5/admin/analytics/intelligence/actions/rec1', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ status: 'done', note: 'selftest done', action_title: '今日待办', action_type: 'approval_workload' }) });
  const r7kPatchText = await r7kPatch.text();
  console.log('/admin/analytics/intelligence/actions patch', r7kPatch.status, r7kPatchText);
  const r7kPatchData = JSON.parse(r7kPatchText).data || {};
  if (r7kPatch.status !== 200 || r7kPatchData.action?.status !== 'done') {
    throw new Error('/admin/analytics/intelligence/actions patch failed');
  }
  const recommendationUrls = r7kData.recommendations.map((item) => String(item.action_url || ''));
  if (!recommendationUrls.includes('/admin/faults?status=pending&device_code=R200') || !recommendationUrls.includes('/admin/stats?range=30d&focus=peak-slot') || !recommendationUrls.includes('/admin/reservations?status=pending') || !recommendationUrls.includes('/admin/devices?device_code=R201')) {
    throw new Error('/admin/analytics/intelligence recommendations missing contextual action URLs');
  }
  const r7a = await fetch(u + '/api/v5/admin/users', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/users', r7a.status, await r7a.text());
  const r7b = await fetch(u + '/api/v5/admin/users/u2', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/users/detail', r7b.status, await r7b.text());
  const r7c = await fetch(u + '/api/v5/admin/users/u2/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ status: 'active' }) });
  console.log('/admin/users/status', r7c.status, await r7c.text());
  const r7c2 = await fetch(u + '/api/v5/admin/users/u2/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ status: 'rejected', reason: '资料不完整，请补充手机号和学号。' }) });
  console.log('/admin/users/status reject', r7c2.status, await r7c2.text());
  const r7d = await fetch(u + '/api/v5/admin/users/u2/ban', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ is_banned: true }) });
  console.log('/admin/users/ban', r7d.status, await r7d.text());
  const r7e = await fetch(u + '/api/v5/admin/users/u2/wechat-binding', { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/users/wechat-binding', r7e.status, await r7e.text());
  const r7f = await fetch(u + '/api/v5/admin/users/u2', { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/users/delete', r7f.status, await r7f.text());
  const r8 = await fetch(u + '/api/v5/devices');
  console.log('/devices', r8.status, await r8.text());
  const r8a = await fetch(u + '/api/v5/system/notice');
  console.log('/system/notice', r8a.status, await r8a.text());
  const r8b = await fetch(u + '/api/v5/system/staff-contacts');
  console.log('/system/staff-contacts', r8b.status, await r8b.text());
  const r8c = await fetch(u + '/api/v5/auth/wechat/challenge');
  console.log('/auth/wechat/challenge', r8c.status, await r8c.text());
  const r8d = await fetch(u + '/api/v5/auth/wechat/status?code=12345');
  console.log('/auth/wechat/status', r8d.status, await r8d.text());
  const r8e = await fetch(u + '/api/v5/auth/wechat/bind', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ temp_code: '12345', name: '新用户', student_no: 'S1', phone: '13800000002' }) });
  console.log('/auth/wechat/bind', r8e.status, await r8e.text());
  const r9 = await fetch(u + '/api/v5/devices/R200');
  const r9Text = await r9.text();
  console.log('/devices/R200', r9.status, r9Text);
  const r9Data = JSON.parse(r9Text).data || {};
  if (!Array.isArray(r9Data.occupancy_14_days) || !Array.isArray(r9Data.recent_fault_reports) || !('current_borrow' in r9Data) || !('next_reservation' in r9Data)) {
    throw new Error('/devices/R200 missing v5 detail snapshots');
  }
  const reservationPayload = { device_codes: ['R200'], reservation_dates: ['2026-07-06'], slot_keys: ['morning'], reservation_groups: [{ device_codes: ['R200'], reservation_dates: ['2026-07-06'], slot_keys: ['morning'] }], purpose: 'v5 visual reservation selftest' };
  const r10 = await fetch(u + '/api/v5/reservation-batches/precheck', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(reservationPayload) });
  console.log('/reservation-batches/precheck', r10.status, await r10.text());
  const r11 = await fetch(u + '/api/v5/reservation-batches', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(reservationPayload) });
  console.log('/reservation-batches', r11.status, await r11.text());
  const r12 = await fetch(u + '/api/v5/reservation-batches/me', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/reservation-batches/me', r12.status, await r12.text());
  const r12a = await fetch(u + '/api/v5/reservation-batches/b1', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/reservation-batches/detail', r12a.status, await r12a.text());
  const r12b = await fetch(u + '/api/v5/reservation-items/ri1/cancel', { method: 'PATCH', headers: { Authorization: 'Bearer ' + tok } });
  console.log('/reservation-items/cancel', r12b.status, await r12b.text());
  const r12c = await fetch(u + '/api/v5/my-records', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/my-records', r12c.status, await r12c.text());
  const r13 = await fetch(u + '/api/v5/calendar/days/2026-07-05', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/calendar/days', r13.status, await r13.text());
  const r13a = await fetch(u + '/api/v5/calendar?start=2026-07-01&end=2026-08-11', { headers: { Authorization: 'Bearer ' + tok } });
  const r13aText = await r13a.text();
  console.log('/calendar month', r13a.status, r13aText);
  const r13aData = JSON.parse(r13aText).data || {};
  const firstCalendarEvent = r13aData.events?.[0];
  if (r13a.status !== 200 || !Array.isArray(r13aData.events) || !firstCalendarEvent || (!firstCalendarEvent.event_id && !firstCalendarEvent.id) || (!firstCalendarEvent.source_type && !firstCalendarEvent.type)) {
    throw new Error('/calendar month missing stable event id/source fields for color-block popover UI');
  }
  const r14 = await fetch(u + '/api/v5/admin/reservation-batches', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/reservation-batches', r14.status, await r14.text());
  const r14NoPermView = await fetch(u + '/api/v5/admin/reservation-batches', { headers: { Authorization: 'Bearer ' + noApprovalTok } });
  console.log('/admin/reservation-batches no approval admin view', r14NoPermView.status, await r14NoPermView.text());
  const r14NoPerm = await fetch(u + '/api/v5/admin/reservation-batches/b1/approval', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + noApprovalTok }, body: JSON.stringify({ approved: true, admin_note: 'should be denied' }) });
  const r14NoPermText = await r14NoPerm.text();
  console.log('/admin/reservation-batches approval no perm', r14NoPerm.status, r14NoPermText);
  if (r14NoPerm.status !== 403) {
    throw new Error('admin without reservation.approve must not change user reservation plans');
  }
  const r14NoPermItem = await fetch(u + '/api/v5/admin/reservation-items/ri1/approval', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + noApprovalTok }, body: JSON.stringify({ approve: true, admin_note: 'should be denied' }) });
  const r14NoPermItemText = await r14NoPermItem.text();
  console.log('/admin/reservation-items approval no perm', r14NoPermItem.status, r14NoPermItemText);
  if (r14NoPermItem.status !== 403) {
    throw new Error('admin without reservation.approve must not change individual reservation items');
  }
  const r14NoPermPlan = await fetch(u + '/api/v5/admin/reservation-items/ri1/plan', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + noApprovalTok }, body: JSON.stringify({ start_time: '2026-07-06T09:00:00.000Z', end_time: '2026-07-06T11:00:00.000Z', admin_note: 'should be denied' }) });
  const r14NoPermPlanText = await r14NoPermPlan.text();
  console.log('/admin/reservation-items plan no change_plan', r14NoPermPlan.status, r14NoPermPlanText);
  if (r14NoPermPlan.status !== 403) {
    throw new Error('admin without reservation.change_plan must not adjust user reservation plans');
  }
  const r14Plan = await fetch(u + '/api/v5/admin/reservation-items/ri1/plan', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + changePlanTok }, body: JSON.stringify({ start_time: '2026-07-06T09:00:00.000Z', end_time: '2026-07-06T11:00:00.000Z', admin_note: 'authorized change' }) });
  console.log('/admin/reservation-items plan authorized', r14Plan.status, await r14Plan.text());
  if (r14Plan.status !== 200) {
    throw new Error('admin with reservation.change_plan should be able to adjust user reservation plans');
  }
  const r14x = await fetch(u + '/api/v5/admin/exports/usage?start_date=2026-07-01&end_date=2026-07-05', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/exports usage', r14x.status, await r14x.text());
  const r14xNoPerm = await fetch(u + '/api/v5/admin/exports/usage?start_date=2026-07-01&end_date=2026-07-05', { headers: { Authorization: 'Bearer ' + noExportTok } });
  console.log('/admin/exports usage no stats.export', r14xNoPerm.status, await r14xNoPerm.text());
  if (r14xNoPerm.status !== 403) {
    throw new Error('admin without stats.export must not export documents');
  }
  const r14xFault = await fetch(u + '/api/v5/admin/exports/faults?start_date=2026-07-01&end_date=2026-07-05', { headers: { Authorization: 'Bearer ' + faultExportTok } });
  console.log('/admin/exports faults fault manager', r14xFault.status, await r14xFault.text());
  if (r14xFault.status !== 200) {
    throw new Error('admin with stats.export + fault.manage should be able to export fault documents');
  }
  const r14xFaultReturnDenied = await fetch(u + '/api/v5/admin/exports/faults?start_date=2026-07-01&end_date=2026-07-05', { headers: { Authorization: 'Bearer ' + returnConfirmTok } });
  console.log('/admin/exports faults return.confirm only', r14xFaultReturnDenied.status, await r14xFaultReturnDenied.text());
  if (r14xFaultReturnDenied.status !== 403) {
    throw new Error('return.confirm must not export fault reports');
  }
  const r14xAuditExport = await fetch(u + '/api/v5/admin/exports/audit_logs?start_date=2026-07-01&end_date=2026-07-05', { headers: { Authorization: 'Bearer ' + auditExportTok } });
  console.log('/admin/exports audit_logs audit export admin', r14xAuditExport.status, await r14xAuditExport.text());
  if (r14xAuditExport.status !== 200) {
    throw new Error('admin with audit.view + stats.export should be able to export audit logs');
  }
  const r14xAuditDenied = await fetch(u + '/api/v5/admin/audit/operation-logs?limit=20', { headers: { Authorization: 'Bearer ' + statsOnlyTok } });
  console.log('/admin/audit/operation-logs stats.view only', r14xAuditDenied.status, await r14xAuditDenied.text());
  if (r14xAuditDenied.status !== 403) {
    throw new Error('admin with stats.view only must not access operation audit logs');
  }
  const r14xAudit = await fetch(u + '/api/v5/admin/audit/operation-logs?limit=20', { headers: { Authorization: 'Bearer ' + auditTok } });
  const r14xAuditText = await r14xAudit.text();
  console.log('/admin/audit/operation-logs audit.view', r14xAudit.status, r14xAuditText);
  if (r14xAudit.status !== 200 || !Array.isArray((JSON.parse(r14xAuditText).data || {}).logs)) {
    throw new Error('admin with audit.view should be able to access operation audit logs');
  }
  const r14j = await fetch(u + '/api/v5/admin/reservation-batches/b1', { headers: { Authorization: 'Bearer ' + tok } });
  const r14jText = await r14j.text();
  console.log('/admin/reservation-batches/detail', r14j.status, r14jText);
  const r14jData = JSON.parse(r14jText).data || {};
  if (r14j.status !== 200 || !r14jData.approval_risk || !r14jData.approval_risk.action_label || typeof r14jData.approval_risk.risk_score !== 'number' || !r14jData.approval_risk.signal_counts) {
    throw new Error('/admin/reservation-batches/detail missing smart approval suggestion payload');
  }
  const r14k = await fetch(u + '/api/v5/admin/reservation-batches/b1/approval', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ approved: true, admin_note: 'ok' }) });
  console.log('/admin/reservation-batches approval', r14k.status, await r14k.text());
  const r14l = await fetch(u + '/api/v5/admin/reservation-items/ri1/approval', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ approve: true, admin_note: 'ok' }) });
  console.log('/admin/reservation-items approval', r14l.status, await r14l.text());
  const r14a = await fetch(u + '/api/v5/admin/system/security-config', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/system/security-config', r14a.status, await r14a.text());
  const r14b = await fetch(u + '/api/v5/admin/system/activity-summary', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/system/activity-summary', r14b.status, await r14b.text());
  const r14c = await fetch(u + '/api/v5/admin/system/reports/daily-usage', { headers: { Authorization: 'Bearer ' + tok } });
  const r14cText = await r14c.text();
  console.log('/admin/system/reports/daily-usage', r14c.status, r14cText);
  const r14cData = JSON.parse(r14cText).data || {};
  if (r14c.status !== 200 || !r14cData.intelligence_summary || !r14cData.smart_insights || !String(r14cData.message || '').includes('智能运营解读')) {
    throw new Error('/admin/system/reports/daily-usage missing smart daily interpretation payload');
  }
  const r14d = await fetch(u + '/api/v5/admin/system/reports/daily-usage/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ timezone: 'Asia/Shanghai' }) });
  const r14dText = await r14d.text();
  console.log('/admin/system/reports/daily-usage/send', r14d.status, r14dText);
  const r14dData = JSON.parse(r14dText).data || {};
  if (r14d.status !== 200 || !r14dData.intelligence_summary || !r14dData.smart_insights || !String(r14dData.message || '').includes('智能运营解读')) {
    throw new Error('/admin/system/reports/daily-usage/send missing smart daily interpretation payload');
  }
  const r14e = await fetch(u + '/api/v5/admin/devices', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/devices', r14e.status, await r14e.text());
  const r14f = await fetch(u + '/api/v5/admin/devices', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ device_code: 'R201', name: '新设备', status: 'available', reservation_slot_keys: ['morning'] }) });
  console.log('/admin/devices create', r14f.status, await r14f.text());
  const r14g = await fetch(u + '/api/v5/admin/devices/d1', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ name: '测试设备改', status: 'maintenance', allow_reservation: false }) });
  console.log('/admin/devices update', r14g.status, await r14g.text());
  const r14h = await fetch(u + '/api/v5/admin/devices/d1/availability', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ available: true }) });
  console.log('/admin/devices availability', r14h.status, await r14h.text());
  const r14i = await fetch(u + '/api/v5/admin/devices/d1', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/devices detail', r14i.status, await r14i.text());
  const r15 = await fetch(u + '/api/v5/borrow-records', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ reservation_item_id: 'ri1' }) });
  console.log('/borrow-records', r15.status, await r15.text());
  const r16 = await fetch(u + '/api/v5/borrow-records/br1/return', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ return_condition: '正常' }) });
  console.log('/borrow-records/return', r16.status, await r16.text());
  const r17 = await fetch(u + '/api/v5/fault-reports', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ device_code: 'R200', issue_type: 'device_fault', severity: 'high', description: '异常', photos: ['/uploads/fault.png'] }) });
  console.log('/fault-reports', r17.status, await r17.text());
  const r17z = await fetch(u + '/api/v5/fault-reports', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/fault-reports mine', r17z.status, await r17z.text());
  const r17z1 = await fetch(u + '/api/v5/admin/fault-reports?status=pending&device_code=R200', { headers: { Authorization: 'Bearer ' + tok } });
  const r17z1Text = await r17z1.text();
  console.log('/admin/fault-reports filtered', r17z1.status, r17z1Text);
  if (r17z1.status !== 200 || lastAdminFaultParams?.status !== 'pending' || lastAdminFaultParams?.device_code !== 'R200') {
    throw new Error('/admin/fault-reports missing contextual status/device_code filtering');
  }
  const r17zFaultDenied = await fetch(u + '/api/v5/admin/fault-reports/f1/resolve', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + returnConfirmTok }, body: JSON.stringify({ status: 'processing', admin_note: 'should be denied', keep_maintenance: true }) });
  console.log('/admin/fault-reports resolve return.confirm only', r17zFaultDenied.status, await r17zFaultDenied.text());
  if (r17zFaultDenied.status !== 403) {
    throw new Error('return.confirm must not resolve fault reports or alter device availability');
  }
  const r17z2 = await fetch(u + '/api/v5/admin/fault-reports/f1/resolve', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ status: 'processing', admin_note: '已联系用户并暂停预约。', keep_maintenance: true }) });
  console.log('/admin/fault-reports processing', r17z2.status, await r17z2.text());
  const r17z3 = await fetch(u + '/api/v5/admin/fault-reports/f1/resolve', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ status: 'resolved', admin_note: '已处理并恢复。', set_available: true }) });
  console.log('/admin/fault-reports resolve', r17z3.status, await r17z3.text());
  const r17a = await fetch(u + '/api/v5/user-requests', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/user-requests', r17a.status, await r17a.text());
  const r17b = await fetch(u + '/api/v5/user-requests', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ title: '希望增加夜间预约说明', description: '夜间设备使用注意事项需要更清楚。', category: 'feature', priority: 'normal', device_code: 'R200' }) });
  console.log('/user-requests create', r17b.status, await r17b.text());
  const r17c = await fetch(u + '/api/v5/user-requests/ur1', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ title: '希望增加夜间预约说明', description: '补充更详细的诉求描述。', category: 'feature', priority: 'high' }) });
  console.log('/user-requests update', r17c.status, await r17c.text());
  const r17d = await fetch(u + '/api/v5/user-requests/ur1/cancel', { method: 'PATCH', headers: { Authorization: 'Bearer ' + tok } });
  console.log('/user-requests cancel', r17d.status, await r17d.text());
  const r17e = await fetch(u + '/api/v5/user-requests/ur1/change-request', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ reason: '需要补充设备使用背景' }) });
  console.log('/user-requests change-request', r17e.status, await r17e.text());
  const r17f = await fetch(u + '/api/v5/admin/user-requests', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/admin/user-requests', r17f.status, await r17f.text());
  const r17fReservationApproval = await fetch(u + '/api/v5/admin/user-requests', { headers: { Authorization: 'Bearer ' + reservationApproveTok } });
  console.log('/admin/user-requests reservation.approve', r17fReservationApproval.status, await r17fReservationApproval.text());
  if (r17fReservationApproval.status !== 200) {
    throw new Error('reservation.approve should be able to view the request list shown in its module');
  }
  const r17fReadonly = await fetch(u + '/api/v5/admin/user-requests/ur1/review', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + requestReadonlyTok }, body: JSON.stringify({ status: 'confirmed', admin_note: 'should be denied' }) });
  const r17fReadonlyText = await r17fReadonly.text();
  console.log('/admin/user-requests review no user.manage', r17fReadonly.status, r17fReadonlyText);
  if (r17fReadonly.status !== 403) {
    throw new Error('admin without user.manage must not review or lock user requests');
  }
  const r17g = await fetch(u + '/api/v5/admin/user-requests/ur1/review', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ status: 'confirmed', admin_note: '已确认，后续排期处理。' }) });
  console.log('/admin/user-requests review', r17g.status, await r17g.text());
  const r18 = await fetch(u + '/api/v5/notifications', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/notifications', r18.status, await r18.text());
  const r19 = await fetch(u + '/api/v5/notifications/read', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ ids: ['n1'] }) });
  console.log('/notifications/read', r19.status, await r19.text());
  const r20 = await fetch(u + '/api/v5/chat/conversations', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/chat/conversations', r20.status, await r20.text());
  const r20a = await fetch(u + '/api/v5/chat/users', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/chat/users', r20a.status, await r20a.text());
  const r20b = await fetch(u + '/api/v5/chat/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ type: 'group', user_ids: ['u2', 'u3'], title: '新群聊' }) });
  console.log('/chat/conversations create', r20b.status, await r20b.text());
  const r20c = await fetch(u + '/api/v5/chat/conversations/c1/participants', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ user_ids: ['u3'] }) });
  console.log('/chat/participants add', r20c.status, await r20c.text());
  const r20d = await fetch(u + '/api/v5/chat/conversations/c1/participants/u2', { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
  console.log('/chat/participants delete', r20d.status, await r20d.text());
  const r20e = await fetch(u + '/api/v5/chat/conversations/c1/participants/u2/remove', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
  console.log('/chat/participants remove', r20e.status, await r20e.text());
  const r20f = await fetch(u + '/api/v5/chat/events?token=' + encodeURIComponent(tok));
  console.log('/chat/events', r20f.status, await r20f.text());
  const r21 = await fetch(u + '/api/v5/chat/conversations/c1/messages', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('/chat/messages', r21.status, await r21.text());
  const r22 = await fetch(u + '/api/v5/chat/conversations/c1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ content: '收到' }) });
  console.log('/chat/send', r22.status, await r22.text());
  const r22a = await fetch(u + '/api/v5/chat/conversations/c1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ message_type: 'image', content: '图片', attachments: [{ type: 'image', url: '/uploads/test.png', name: 'test.png' }] }) });
  console.log('/chat/send image', r22a.status, await r22a.text());
  const r22card = await fetch(u + '/api/v5/chat/conversations/c1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ message_type: 'device_card', content: '设备卡片：R200', metadata: { title: '设备咨询：R200', device_code: 'R200', device_name: '测试设备' }, related_type: 'device', related_id: 'R200' }) });
  console.log('/chat/send card', r22card.status, await r22card.text());
  const r22b = await fetch(u + '/api/v5/chat/conversations/c1/leave', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
  console.log('/chat/leave', r22b.status, await r22b.text());
  const r22c = await fetch(u + '/api/v5/chat/conversations/c1', { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
  console.log('/chat/dissolve', r22c.status, await r22c.text());
  srv.close();
});




function createDashboardService(context = {}) {
  const {
    currentReservationDateCondition,
    ok,
    query,
    queryOne,
    requireAdminRole
  } = context;

  async function adminDashboard(_, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['reservation.view', 'device.view', 'stats.view']);
    const deviceRows = await query('select status, count(*)::int as count from devices group by status');
    const userPending = await queryOne("select count(*)::int as count from users where status = 'pending'");
    const reservationPending = await queryOne(`select count(*)::int as count from reservation_items where status = 'pending' and ${currentReservationDateCondition('reservation_items')}`);
    const todayReservations = await queryOne("select count(*)::int as count from reservation_items where start_time >= date_trunc('day', now()) and start_time < date_trunc('day', now()) + interval '1 day'");
    const weekUsage = await queryOne("select count(*)::int as count from borrow_records where borrow_time >= date_trunc('week', now())");
    const faultPending = await queryOne("select count(*)::int as count from device_fault_reports where status in ('pending', 'processing')");
    const chatUnread = await queryOne(`
      select count(m.id)::int as message_count,
        count(distinct m.conversation_id)::int as conversation_count
      from chat_participants p
      join users u on u.id = p.user_id and u.role in ('super_admin', 'admin')
      join chat_messages m on m.conversation_id = p.conversation_id
        and m.sender_id <> p.user_id
        and (p.last_read_at is null or m.created_at > p.last_read_at)
    `) || { message_count: 0, conversation_count: 0 };
    const byStatus = Object.fromEntries((deviceRows || []).map((row) => [row.status, Number(row.count) || 0]));
    const totalDevices = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
    return ok({
      kpi: {
        device_total: totalDevices,
        available_devices: byStatus.available || 0,
        in_use_devices: byStatus.in_use || 0,
        abnormal_devices: (byStatus.abnormal_pending || 0) + (byStatus.maintenance || 0) + (faultPending?.count || 0),
        pending_users: userPending?.count || 0,
        pending_reservations: reservationPending?.count || 0,
        today_reservations: todayReservations?.count || 0,
        week_usage_count: weekUsage?.count || 0,
        unread_chat_messages: Number(chatUnread?.message_count || 0),
        unread_chat_conversations: Number(chatUnread?.conversation_count || 0)
      },
      device_status: byStatus
    });
  }

  return { adminDashboard };
}

module.exports = { createDashboardService };

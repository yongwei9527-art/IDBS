function createReservationReminderService(context = {}) {
  const { createUserNotification, nowIso, query, uuid } = context;

  async function notificationExists(userId, type, relatedId) {
    const rows = await query('select 1 from user_notifications where user_id=$1 and type=$2 and related_id=$3 limit 1', [userId, type, relatedId]);
    return Boolean(rows?.length);
  }

  async function writeReminder(row, type, title, content) {
    if (!row.user_id || await notificationExists(row.user_id, type, row.id)) return false;
    // Borrow records do not have a reservation parent. reservation_id is a strict FK,
    // so the reminder keeps its own related_id and writes a parent only when one exists.
    return createUserNotification({ user_id: row.user_id, type, title, content, related_type: row.reservation_id ? 'reservation_reminder' : 'borrow_record', related_id: row.id, device_id: row.device_id, reservation_id: row.reservation_id || null });
  }

  async function runReservationReminderLifecycle(nowValue = nowIso()) {
    const now = new Date(nowValue);
    if (Number.isNaN(now.getTime())) return { reservation_day_before: 0, reservation_soon: 0, return_soon: 0, overdue: 0 };
    const dayStart = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
    const dayEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();
    const soonStart = new Date(now.getTime() + 25 * 60 * 1000).toISOString();
    const soonEnd = new Date(now.getTime() + 35 * 60 * 1000).toISOString();
    const results = { reservation_day_before: 0, reservation_soon: 0, return_soon: 0, overdue: 0 };
    const reservations = await query(`select ri.id, ri.reservation_id, ri.user_id, ri.device_id, ri.start_time, ri.end_time, d.device_code, d.name as device_name
      from reservation_items ri join devices d on d.id=ri.device_id
      where ri.status='approved' and ri.start_time between $1 and $2`, [dayStart, dayEnd]);
    for (const row of reservations || []) if (await writeReminder(row, 'reservation_day_before', '明日设备预约提醒', `你明日预约 ${row.device_code} ${row.device_name}，请提前确认实验材料与到场时间。`)) results.reservation_day_before += 1;
    const soonReservations = await query(`select ri.id, ri.reservation_id, ri.user_id, ri.device_id, ri.start_time, ri.end_time, d.device_code, d.name as device_name
      from reservation_items ri join devices d on d.id=ri.device_id
      where ri.status='approved' and ri.start_time between $1 and $2`, [soonStart, soonEnd]);
    for (const row of soonReservations || []) if (await writeReminder(row, 'reservation_soon', '预约即将开始', `你预约的 ${row.device_code} ${row.device_name} 将在约 30 分钟后开始，请按时到场；如无法使用请尽快取消。`)) results.reservation_soon += 1;
    const borrows = await query(`select b.id, b.user_id, b.device_id, d.device_code, d.name as device_name
      from borrow_records b join devices d on d.id=b.device_id
      where b.status='in_use' and b.expected_return_time between $1 and $2`, [soonStart, soonEnd]);
    for (const row of borrows || []) if (await writeReminder(row, 'return_soon', '归还时间临近', `你正在使用的 ${row.device_code} ${row.device_name} 将在约 30 分钟后到期。下一时段无人预约时可申请续约，否则请按时归还。`)) results.return_soon += 1;
    const overdue = await query(`select b.id, b.user_id, b.device_id, d.device_code, d.name as device_name
      from borrow_records b join devices d on d.id=b.device_id
      where b.status='in_use' and b.expected_return_time < $1`, [now.toISOString()]);
    for (const row of overdue || []) if (await writeReminder(row, 'borrow_overdue', '借用已逾期', `你正在使用的 ${row.device_code} ${row.device_name} 已超过预计归还时间，请立即归还或联系管理员处理。`)) results.overdue += 1;
    return results;
  }

  return { runReservationReminderLifecycle };
}
module.exports = { createReservationReminderService };

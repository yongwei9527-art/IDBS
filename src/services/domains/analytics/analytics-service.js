function analyticsRange(params = {}) {
  const now = new Date();
  const range = String(params.range || '30d');
  const end = params.end_date ? new Date(`${params.end_date}T23:59:59+08:00`) : now;
  const start = params.start_date ? new Date(`${params.start_date}T00:00:00+08:00`) : new Date(end.getTime() - (range === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function createAnalyticsService(context = {}) {
  const {
    addNamesToBorrowRows,
    ok,
    query,
    requireAdminRole
  } = context;

  async function usageStats(payload, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['stats.view', 'stats.export']);
    const { user_id: userId, device_id: deviceId, start_date: startDate, end_date: endDate } = payload;
    let sql = 'select * from borrow_records where return_time is not null';
    const params = [];
    const clauses = [];
    if (userId) { params.push(userId); clauses.push(`user_id = $${params.length}`); }
    if (deviceId) { params.push(deviceId); clauses.push(`device_id = $${params.length}`); }
    if (startDate) { params.push(new Date(startDate).toISOString()); clauses.push(`borrow_time >= $${params.length}`); }
    if (endDate) { const end = new Date(endDate); end.setDate(end.getDate() + 1); params.push(end.toISOString()); clauses.push(`borrow_time < $${params.length}`); }
    if (clauses.length) sql += ` and ${clauses.join(' and ')}`;
    sql += ' order by borrow_time desc';
    const rows = await query(sql, params);
    const hydrated = await addNamesToBorrowRows(rows || []);
    const totalMinutes = hydrated.reduce((sum, row) => sum + (Number(row.duration_minutes) || 0), 0);
    const abnormalCount = hydrated.filter((row) => row.return_condition && row.return_condition !== 'normal').length;
    const overdueCount = hydrated.filter((row) => row.is_overdue).length;
    return ok({ summary: { count: hydrated.length, total_minutes: totalMinutes, total_hours: Math.round((totalMinutes / 60) * 100) / 100, avg_minutes: hydrated.length ? Math.round(totalMinutes / hydrated.length) : 0, abnormal_count: abnormalCount, overdue_count: overdueCount }, rows: hydrated });
  }

  async function adminAnalyticsOverview(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['stats.view']);
    const { start, end } = analyticsRange(params);
    const trend = await query(`
      with days as (
        select generate_series($1::timestamptz, $2::timestamptz, interval '1 day') as day
      ), reservations_by_day as (
        select date_trunc('day', created_at) as day, count(*)::int as count from reservation_items where created_at between $1 and $2 group by 1
      ), borrows_by_day as (
        select date_trunc('day', borrow_time) as day, count(*)::int as count, count(return_time)::int as return_count from borrow_records where borrow_time between $1 and $2 group by 1
      ), faults_by_day as (
        select date_trunc('day', created_at) as day, count(*)::int as count from device_fault_reports where created_at between $1 and $2 group by 1
      )
      select days.day::date,
        coalesce(reservations_by_day.count, 0)::int as reservation_count,
        coalesce(borrows_by_day.count, 0)::int as borrow_count,
        coalesce(borrows_by_day.return_count, 0)::int as return_count,
        coalesce(faults_by_day.count, 0)::int as fault_count
      from days
      left join reservations_by_day on reservations_by_day.day = days.day
      left join borrows_by_day on borrows_by_day.day = days.day
      left join faults_by_day on faults_by_day.day = days.day
      order by days.day
    `, [start, end]);
    const statusRows = await query('select status, count(*)::int as count from devices group by status');
    const approvalRows = await query('select status, count(*)::int as count from reservation_items where created_at between $1 and $2 group by status', [start, end]);
    return ok({ range: { start, end }, trend, device_status: statusRows, approvals: approvalRows });
  }

  async function adminAnalyticsDeviceUsage(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['stats.view']);
    const metric = String(params.metric || 'borrow_count');
    const allowedMetric = ['reservation_count', 'borrow_count', 'total_minutes', 'fault_count'].includes(metric) ? metric : 'borrow_count';
    const rows = await query(`select * from device_usage_summary_view order by ${allowedMetric} desc nulls last limit 20`);
    return ok({ metric: allowedMetric, rows });
  }

  async function adminAnalyticsTimeHeatmap(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['stats.view']);
    const { start, end } = analyticsRange(params);
    const rows = await query(`
      select extract(isodow from start_time at time zone 'Asia/Shanghai')::int as weekday,
        case
          when (start_time at time zone 'Asia/Shanghai')::time >= time '08:00' and (start_time at time zone 'Asia/Shanghai')::time < time '12:00' then 'morning'
          when (start_time at time zone 'Asia/Shanghai')::time >= time '12:00' and (start_time at time zone 'Asia/Shanghai')::time < time '17:00' then 'afternoon'
          when (start_time at time zone 'Asia/Shanghai')::time >= time '17:00' and (start_time at time zone 'Asia/Shanghai')::time < time '22:00' then 'evening'
          else 'night'
        end as slot_key,
        count(*)::int as count
      from reservation_items
      where start_time between $1 and $2
      group by 1, 2
      order by weekday, slot_key
    `, [start, end]);
    return ok({ range: { start, end }, rows });
  }

  async function adminAnalyticsFaults(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['stats.view', 'fault.manage']);
    const { start, end } = analyticsRange(params);
    const trend = await query("select date_trunc('day', created_at)::date as day, count(*)::int as count from device_fault_reports where created_at between $1 and $2 group by day order by day", [start, end]);
    const types = await query("select issue_type, count(*)::int as count from device_fault_reports where created_at between $1 and $2 group by issue_type order by count desc", [start, end]);
    const devices = await query("select d.device_code, d.name as device_name, count(f.id)::int as count from device_fault_reports f join devices d on d.id = f.device_id where f.created_at between $1 and $2 group by d.device_code, d.name order by count desc limit 20", [start, end]);
    return ok({ range: { start, end }, trend, types, devices });
  }

  return {
    adminAnalyticsDeviceUsage,
    adminAnalyticsFaults,
    adminAnalyticsOverview,
    adminAnalyticsTimeHeatmap,
    usageStats
  };
}

module.exports = { createAnalyticsService };

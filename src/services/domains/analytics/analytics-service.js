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

  function isMissingActionLogTable(error) {
    return error?.code === '42P01' || /intelligence_action_logs/i.test(String(error?.message || ''));
  }

  function normalizeActionStatus(status) {
    const value = String(status || 'open').trim().toLowerCase();
    return ['open', 'done', 'ignored', 'delegated'].includes(value) ? value : 'open';
  }

  function fallbackActionLog(payload = {}, admin = {}, persisted = false) {
    const status = normalizeActionStatus(payload.status);
    return {
      id: null,
      action_id: String(payload.action_id || payload.actionId || '').trim(),
      action_type: payload.action_type || payload.type || null,
      action_title: payload.action_title || payload.title || null,
      status,
      note: payload.note || '',
      assigned_to: payload.assigned_to || null,
      assigned_to_name: null,
      handled_by: admin.user_id || admin.id || null,
      handled_by_name: admin.name || admin.phone || admin.role || 'admin',
      handled_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      persisted
    };
  }

  function permissionsForActionType(actionType = '') {
    const type = String(actionType || '').trim();
    if (type.includes('fault')) return ['device.manage', 'fault.manage'];
    if (type.includes('overdue') || type.includes('reservation')) return ['reservation.approve'];
    if (type.includes('user')) return ['user.manage'];
    return ['stats.view'];
  }

  async function latestActionLogsById(actionIds = []) {
    const ids = [...new Set(actionIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return new Map();
    try {
      const rows = await query(`
        select distinct on (l.action_id)
          l.*,
          handler.name as handled_by_name,
          assignee.name as assigned_to_name
        from intelligence_action_logs l
        left join users handler on handler.id = l.handled_by
        left join users assignee on assignee.id = l.assigned_to
        where l.action_id = any($1::text[])
        order by l.action_id, l.updated_at desc, l.created_at desc
      `, [ids]);
      return new Map((rows || []).map((row) => [String(row.action_id), row]));
    } catch (error) {
      if (isMissingActionLogTable(error)) return new Map();
      throw error;
    }
  }

  function withExecutionState(action, logRow) {
    return {
      ...action,
      execution_status: normalizeActionStatus(logRow?.status),
      execution_note: logRow?.note || '',
      handled_at: logRow?.handled_at || null,
      handled_by: logRow?.handled_by || null,
      handled_by_name: logRow?.handled_by_name || null,
      assigned_to: logRow?.assigned_to || null,
      assigned_to_name: logRow?.assigned_to_name || null
    };
  }

  async function adminListIntelligenceActionLogs(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view']);
    const clauses = [];
    const values = [];
    const actionId = String(params.action_id || params.actionId || '').trim();
    const status = String(params.status || '').trim().toLowerCase();
    if (actionId) {
      values.push(actionId);
      clauses.push(`l.action_id = $${values.length}`);
    }
    if (status && ['open', 'done', 'ignored', 'delegated'].includes(status)) {
      values.push(status);
      clauses.push(`l.status = $${values.length}`);
    }
    values.push(Math.min(200, Math.max(1, Number(params.limit) || 80)));
    try {
      const logs = await query(`
        select
          l.*,
          handler.name as handled_by_name,
          assignee.name as assigned_to_name
        from intelligence_action_logs l
        left join users handler on handler.id = l.handled_by
        left join users assignee on assignee.id = l.assigned_to
        ${clauses.length ? `where ${clauses.join(' and ')}` : ''}
        order by l.updated_at desc, l.created_at desc
        limit $${values.length}
      `, values);
      return ok({ logs: logs || [], persisted: true });
    } catch (error) {
      if (isMissingActionLogTable(error)) return ok({ logs: [], persisted: false, warning: 'intelligence_action_logs table is not available yet' });
      throw error;
    }
  }

  async function adminUpdateIntelligenceAction(payload = {}, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view']);
    const actionId = String(payload.action_id || payload.actionId || '').trim();
    if (!actionId) {
      const error = new Error('智能运营动作编号不能为空。');
      error.status = 400;
      throw error;
    }
    const status = normalizeActionStatus(payload.status);
    const actionType = String(payload.action_type || payload.type || '').trim() || null;
    const actionTitle = String(payload.action_title || payload.title || '').trim() || null;
    await requireAdminRole(token, ['super_admin', 'admin'], permissionsForActionType(actionType));
    const note = String(payload.note || '').trim();
    const assignedTo = payload.assigned_to ? String(payload.assigned_to) : null;
    const handledBy = admin.user_id || admin.id || null;
    try {
      const rows = await query(`
        insert into intelligence_action_logs (
          action_id, action_type, action_title, status, note, assigned_to, handled_by, handled_at, created_at, updated_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,now(),now(),now())
        returning *
      `, [actionId, actionType, actionTitle, status, note, assignedTo, handledBy]);
      const inserted = rows?.[0] || fallbackActionLog({ ...payload, action_id: actionId, status, action_type: actionType, action_title: actionTitle, note, assigned_to: assignedTo }, admin, true);
      return ok({ action: { ...inserted, handled_by_name: admin.name || admin.phone || admin.role || 'admin', persisted: true } });
    } catch (error) {
      if (isMissingActionLogTable(error)) {
        return ok({ action: fallbackActionLog({ ...payload, action_id: actionId, status, action_type: actionType, action_title: actionTitle, note, assigned_to: assignedTo }, admin, false), persisted: false, warning: 'intelligence_action_logs table is not available yet' });
      }
      throw error;
    }
  }

  async function usageStats(payload, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view', 'stats.export']);
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
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view']);
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
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view']);
    const metric = String(params.metric || 'borrow_count');
    const allowedMetric = ['reservation_count', 'borrow_count', 'total_minutes', 'fault_count'].includes(metric) ? metric : 'borrow_count';
    const rows = await query(`select * from device_usage_summary_view order by ${allowedMetric} desc nulls last limit 20`);
    return ok({ metric: allowedMetric, rows });
  }

  async function adminAnalyticsTimeHeatmap(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view']);
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
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view', 'fault.manage']);
    const { start, end } = analyticsRange(params);
    const trend = await query("select date_trunc('day', created_at)::date as day, count(*)::int as count from device_fault_reports where created_at between $1 and $2 group by day order by day", [start, end]);
    const types = await query("select issue_type, count(*)::int as count from device_fault_reports where created_at between $1 and $2 group by issue_type order by count desc", [start, end]);
    const devices = await query("select d.device_code, d.name as device_name, count(f.id)::int as count from device_fault_reports f join devices d on d.id = f.device_id where f.created_at between $1 and $2 group by d.device_code, d.name order by count desc limit 20", [start, end]);
    return ok({ range: { start, end }, trend, types, devices });
  }

  function levelFromRatio(value, max) {
    if (!value || !max) return 'low';
    const ratio = Number(value) / Number(max);
    if (ratio >= 0.75) return 'high';
    if (ratio >= 0.35) return 'medium';
    return 'low';
  }

  function recommendation(id, level, type, title, description, evidence, actionLabel, actionUrl) {
    return {
      id,
      level,
      type,
      title,
      description,
      evidence: evidence.filter(Boolean),
      action_label: actionLabel,
      action_url: actionUrl
    };
  }

  async function adminAnalyticsIntelligence(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view']);
    const range = String(params.range || '30d');
    const { start, end } = analyticsRange({ ...params, range });

    const [deviceRisks, demandRows, workloadRows, lowUtilizationRows, exceptionReasonRows] = await Promise.all([
      query(`
      with usage_rows as (
        select device_id,
          count(*)::int as usage_count,
          count(*) filter (where return_condition is not null and return_condition <> 'normal')::int as abnormal_return_count,
          count(*) filter (where is_overdue = true or (status = 'in_use' and expected_return_time < now()))::int as overdue_count
        from borrow_records
        where borrow_time between $1 and $2
        group by device_id
      ), fault_rows as (
        select device_id,
          count(*)::int as fault_count,
          count(*) filter (where severity in ('high','critical','danger'))::int as high_fault_count,
          count(*) filter (where status in ('pending','processing'))::int as open_fault_count
        from device_fault_reports
        where created_at between $1 and $2
        group by device_id
      ), reservation_rows as (
        select device_id, count(*)::int as reservation_count
        from reservation_items
        where start_time between $1 and $2
        group by device_id
      )
      select d.id,
        d.device_code,
        d.name as device_name,
        d.status,
        coalesce(u.usage_count, 0)::int as usage_count,
        coalesce(r.reservation_count, 0)::int as reservation_count,
        coalesce(f.fault_count, 0)::int as fault_count,
        coalesce(f.high_fault_count, 0)::int as high_fault_count,
        coalesce(f.open_fault_count, 0)::int as open_fault_count,
        coalesce(u.abnormal_return_count, 0)::int as abnormal_return_count,
        coalesce(u.overdue_count, 0)::int as overdue_count,
        least(100,
          coalesce(f.fault_count, 0) * 18
          + coalesce(f.high_fault_count, 0) * 16
          + coalesce(f.open_fault_count, 0) * 10
          + coalesce(u.abnormal_return_count, 0) * 12
          + coalesce(u.overdue_count, 0) * 10
          + case when d.status in ('abnormal_pending','maintenance') then 25 when d.status = 'in_use' then 4 else 0 end
        )::int as risk_score
      from devices d
      left join usage_rows u on u.device_id = d.id
      left join fault_rows f on f.device_id = d.id
      left join reservation_rows r on r.device_id = d.id
      where d.status <> 'disabled'
      order by risk_score desc, fault_count desc, abnormal_return_count desc, reservation_count desc, d.device_code
      limit 12
      `, [start, end]),

      query(`
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
        and status in ('pending','approved','in_use','completed')
      group by 1, 2
      order by count desc, weekday, slot_key
      limit 12
      `, [start, end]),

      query(`
      select
        (select count(*)::int from reservation_items where status = 'pending') as pending_reservations,
        (select count(*)::int from users where status = 'pending' and coalesce(is_banned, false) = false) as pending_users,
        (select count(*)::int from device_fault_reports where status in ('pending','processing')) as pending_faults,
        (select count(*)::int from borrow_records where status = 'in_use' and (is_overdue = true or expected_return_time < now())) as overdue_borrows
      `),

      query(`
      with usage_rows as (
        select device_id, count(*)::int as usage_count
        from borrow_records
        where borrow_time between $1 and $2
        group by device_id
      ), reservation_rows as (
        select device_id, count(*)::int as reservation_count
        from reservation_items
        where start_time between $1 and $2
        group by device_id
      )
      select d.device_code,
        d.name as device_name,
        d.status,
        coalesce(u.usage_count, 0)::int as usage_count,
        coalesce(r.reservation_count, 0)::int as reservation_count
      from devices d
      left join usage_rows u on u.device_id = d.id
      left join reservation_rows r on r.device_id = d.id
      where d.status in ('available','reserved')
      order by coalesce(u.usage_count, 0), coalesce(r.reservation_count, 0), d.device_code
      limit 8
      `, [start, end]),

      query(`
      select event_type as type, category, count(*)::int as count
      from (
        select 'no_show'::text as event_type, no_show_reason_category as category
        from reservation_items
        where status = 'no_show' and start_time between $1 and $2

        union all

        select 'overdue'::text, overdue_reason_category
        from borrow_records
        where is_overdue = true and return_time between $1 and $2

        union all

        select 'abnormal_return'::text, abnormal_reason_category
        from borrow_records
        where abnormal_reason_category is not null and return_time between $1 and $2
      ) exception_causes
      where coalesce(category, '') <> ''
      group by event_type, category
      order by count desc, event_type
      limit 8
      `, [start, end])
    ]);
    const workload = workloadRows?.[0] || { pending_reservations: 0, pending_users: 0, pending_faults: 0, overdue_borrows: 0 };

    const maxDemand = Math.max(0, ...demandRows.map((row) => Number(row.count) || 0));
    const demandForecast = demandRows.map((row) => ({
      ...row,
      count: Number(row.count) || 0,
      level: levelFromRatio(row.count, maxDemand)
    }));

    const normalizedRisks = deviceRisks.map((row) => ({
      ...row,
      risk_score: Number(row.risk_score) || 0,
      fault_count: Number(row.fault_count) || 0,
      abnormal_return_count: Number(row.abnormal_return_count) || 0,
      usage_count: Number(row.usage_count) || 0,
      suggestion: Number(row.risk_score) >= 75
        ? '建议暂停预约并安排维护复检'
        : Number(row.risk_score) >= 45
          ? '建议加入重点巡检清单'
          : '保持常规巡检'
    }));

    const exceptionReasonLabels = {
      no_show: { forgot: '忘记到场', plan_changed: '实验计划变更', schedule_conflict: '临时冲突', other: '其他原因' },
      overdue: { experiment_not_finished: '实验未结束', awaiting_result: '等待实验结果', forgot_return: '忘记归还', other: '其他原因' },
      abnormal_return: { missing_accessory: '缺少配件', appearance_damage: '外观损坏', operation_abnormal: '运行异常', other: '其他原因' }
    };
    const exceptionReasonAdvice = {
      'no_show:forgot': '继续保持预约前 30 分钟提醒，并在提醒中强调未到场规则。',
      'no_show:plan_changed': '可开放预约开始前 1 小时的自助取消，减少无效占用。',
      'no_show:schedule_conflict': '建议在预约前提醒中提供一键取消入口，降低临时冲突造成的爽约。',
      'overdue:experiment_not_finished': '建议为该类设备优化续约入口，并引导用户预留更充足的实验时段。',
      'overdue:awaiting_result': '建议在预计归还前提醒用户提前安排结果等待期间的设备交接。',
      'overdue:forgot_return': '建议强化归还前提醒，并在到期时推送明确的归还指引。',
      'abnormal_return:missing_accessory': '建议在归还验收清单中增加配件逐项核对。',
      'abnormal_return:appearance_damage': '建议补充使用前后照片与外观检查提示。',
      'abnormal_return:operation_abnormal': '建议安排操作培训或优先巡检相关设备。'
    };
    const exceptionReasonSummary = (exceptionReasonRows || []).map((row) => {
      const type = String(row.type || '');
      const category = String(row.category || 'other');
      return {
        type,
        category,
        count: Number(row.count) || 0,
        label: exceptionReasonLabels[type]?.[category] || '其他原因',
        advice: exceptionReasonAdvice[type + ':' + category] || '建议结合具体记录复核原因，并完善相关提示或流程。'
      };
    });
    const topExceptionReason = exceptionReasonSummary.find((row) => row.count >= 2) || null;

    const recommendations = [];
    if (topExceptionReason) {
      const exceptionActionUrl = topExceptionReason.type === 'no_show' ? '/admin/reservations?scope=history' : '/admin/faults';
      const exceptionTypeLabel = topExceptionReason.type === 'no_show'
        ? '\u723d\u7ea6'
        : topExceptionReason.type === 'overdue'
          ? '\u903e\u671f\u5f52\u8fd8'
          : '\u5f02\u5e38\u5f52\u8fd8';
      recommendations.push(recommendation(
        `exception-${topExceptionReason.type}-${topExceptionReason.category}`,
        'info',
        'exception_reason',
        `${topExceptionReason.label}\u51fa\u73b0\u8f83\u591a`,
        topExceptionReason.advice,
        [`\u76f8\u5173\u8bb0\u5f55 ${topExceptionReason.count} \u6761`, `\u7c7b\u578b\uff1a${exceptionTypeLabel}`],
        '\u67e5\u770b\u76f8\u5173\u8bb0\u5f55',
        exceptionActionUrl
      ));
    }
    const topRisk = normalizedRisks.find((row) => row.risk_score >= 45);
    if (topRisk) {
      recommendations.push(recommendation(
        `risk-${topRisk.device_code}`,
        topRisk.risk_score >= 75 ? 'danger' : 'warning',
        'fault_risk',
        `${topRisk.device_name || topRisk.device_code} 风险偏高`,
        '近期故障、异常归还或逾期指标集中，建议优先排查。',
        [
          `风险分 ${topRisk.risk_score}`,
          `故障 ${topRisk.fault_count} 次`,
          `异常归还 ${topRisk.abnormal_return_count} 次`
        ],
        '查看故障处理',
        `/admin/faults?status=pending&device_code=${encodeURIComponent(topRisk.device_code || '')}`
      ));
    }

    const topDemand = demandForecast.find((row) => row.level === 'high');
    if (topDemand) {
      recommendations.push(recommendation(
        `demand-${topDemand.weekday}-${topDemand.slot_key}`,
        'info',
        'peak_slot',
        '高峰预约时段需要提前调度',
        '该时段预约更集中，适合提前开放替代设备或增加审批提醒。',
        [`周 ${topDemand.weekday} / ${topDemand.slot_key}`, `预约 ${topDemand.count} 单`],
        '查看统计分析',
        `/admin/stats?range=${encodeURIComponent(range)}&focus=peak-slot`
      ));
    }

    const pendingWorkload = Number(workload.pending_reservations || 0) + Number(workload.pending_users || 0) + Number(workload.pending_faults || 0) + Number(workload.overdue_borrows || 0);
    if (pendingWorkload > 0) {
      recommendations.push(recommendation(
        'workload-pending',
        Number(workload.pending_faults || 0) + Number(workload.overdue_borrows || 0) > 0 ? 'warning' : 'info',
        'approval_workload',
        '今日待处理工作需要收口',
        '系统检测到审批、用户审核、故障或逾期任务尚未完成。',
        [
          `预约审批 ${workload.pending_reservations || 0}`,
          `用户审核 ${workload.pending_users || 0}`,
          `故障 ${workload.pending_faults || 0}`,
          `逾期 ${workload.overdue_borrows || 0}`
        ],
        '打开预约审批',
        '/admin/reservations?status=pending'
      ));
    }

    const lowUtil = lowUtilizationRows.find((row) => Number(row.usage_count || 0) === 0 && Number(row.reservation_count || 0) <= 1);
    if (lowUtil) {
      recommendations.push(recommendation(
        `low-${lowUtil.device_code}`,
        'success',
        'low_utilization',
        `${lowUtil.device_name || lowUtil.device_code} 使用率偏低`,
        '可补充设备说明、开放更多时段或在首页推荐，提高设备利用率。',
        [`借用 ${lowUtil.usage_count || 0} 次`, `预约 ${lowUtil.reservation_count || 0} 单`],
        '优化设备信息',
        `/admin/devices?device_code=${encodeURIComponent(lowUtil.device_code || '')}`
      ));
    }

    const riskDeviceCount = normalizedRisks.filter((row) => row.risk_score >= 45).length;
    const highDemandSlots = demandForecast.filter((row) => row.level === 'high').length;
    const overdueOrAbnormal = normalizedRisks.reduce((sum, row) => sum + Number(row.overdue_count || 0) + Number(row.abnormal_return_count || 0), 0);
    const lowUtilizationCount = lowUtilizationRows.filter((row) => Number(row.usage_count || 0) === 0 && Number(row.reservation_count || 0) <= 1).length;
    const topRiskScore = Math.max(0, ...normalizedRisks.map((row) => Number(row.risk_score) || 0));
    const healthScore = Math.max(0, Math.min(100, 100 - Math.round(topRiskScore * 0.45) - riskDeviceCount * 4 - Math.min(24, pendingWorkload * 2) - highDemandSlots * 2));
    const healthLevel = healthScore >= 82 ? 'healthy' : healthScore >= 65 ? 'watch' : healthScore >= 45 ? 'risk' : 'critical';
    const healthLabel = healthLevel === 'healthy' ? '运营健康' : healthLevel === 'watch' ? '需要关注' : healthLevel === 'risk' ? '存在风险' : '高压运行';

    function actionFromRecommendation(item, group, ownerRole, estimatedImpact) {
      return {
        id: item.id,
        group,
        level: item.level,
        type: item.type,
        title: item.title,
        description: item.description,
        evidence: item.evidence || [],
        action_label: item.action_label,
        action_url: item.action_url,
        owner_role: ownerRole,
        estimated_impact: estimatedImpact
      };
    }

    const nextActions = recommendations.map((item) => {
      if (item.type === 'fault_risk') return actionFromRecommendation(item, 'urgent', 'device_admin', '降低设备故障与异常归还风险');
      if (item.type === 'approval_workload') return actionFromRecommendation(item, 'today', 'reservation_admin', '减少待办积压，缩短用户等待时间');
      if (item.type === 'low_utilization') return actionFromRecommendation(item, 'optimization', 'ops_admin', '提升设备曝光与使用率');
      return actionFromRecommendation(item, 'monitor', 'ops_admin', '辅助安排高峰时段值守和设备调度');
    });

    if (Number(workload.pending_faults || 0) > 0) {
      nextActions.unshift({
        id: 'faults-open',
        group: 'urgent',
        level: 'warning',
        type: 'fault_backlog',
        title: '优先收敛未处理故障',
        description: '仍有设备故障处于待处理或处理中状态，建议先确认是否需要暂停预约。',
        evidence: [`故障待办 ${workload.pending_faults} 项`],
        action_label: '处理故障',
        action_url: '/admin/faults?status=pending',
        owner_role: 'device_admin',
        estimated_impact: '避免问题设备继续被预约或借用'
      });
    }

    if (Number(workload.overdue_borrows || 0) > 0) {
      nextActions.unshift({
        id: 'borrows-overdue',
        group: 'urgent',
        level: 'danger',
        type: 'overdue_backlog',
        title: '跟进逾期未归还记录',
        description: '逾期借用会影响后续预约履约，建议联系使用人并记录处理结果。',
        evidence: [`逾期 ${workload.overdue_borrows} 条`],
        action_label: '查看统计',
        action_url: '/admin/stats?focus=overdue',
        owner_role: 'reservation_admin',
        estimated_impact: '恢复设备周转，降低预约冲突'
      });
    }

    if (Number(workload.pending_users || 0) > 0) {
      nextActions.push({
        id: 'users-pending',
        group: 'today',
        level: 'info',
        type: 'user_review',
        title: '完成待审核用户处理',
        description: '待审核用户会影响后续预约与借用体验，建议当天完成资料核验。',
        evidence: [`用户审核 ${workload.pending_users} 人`],
        action_label: '审核用户',
        action_url: '/admin/users?status=pending',
        owner_role: 'super_admin',
        estimated_impact: '减少新用户等待，提高系统启用率'
      });
    }

    if (nextActions.length === 0) {
      nextActions.push({
        id: 'monitor-normal',
        group: 'monitor',
        level: 'success',
        type: 'normal_ops',
        title: '运营状态平稳，保持巡检节奏',
        description: '当前没有明显高压信号，建议继续关注高峰时段和设备健康排行。',
        evidence: [`健康分 ${healthScore}`, `待办 ${pendingWorkload} 项`],
        action_label: '查看统计',
        action_url: '/admin/stats',
        owner_role: 'ops_admin',
        estimated_impact: '维持稳定运营'
      });
    }

    const actionGroupMeta = [
      { key: 'urgent', label: '紧急处置', description: '先处理会影响安全、履约或设备可用性的事项。' },
      { key: 'today', label: '今日收口', description: '适合当天完成的审批、审核和运营待办。' },
      { key: 'optimization', label: '优化提升', description: '提升设备利用率、信息完整度和用户体验。' },
      { key: 'monitor', label: '持续观察', description: '用于排班、调度和后续趋势跟踪。' }
    ];
    const latestLogs = await latestActionLogsById(nextActions.map((item) => item.id));
    const nextActionsWithExecution = nextActions.map((item) => withExecutionState(item, latestLogs.get(String(item.id))));

    const actionGroups = actionGroupMeta.map((group) => ({
      ...group,
      count: nextActionsWithExecution.filter((item) => item.group === group.key).length,
      actions: nextActionsWithExecution.filter((item) => item.group === group.key).slice(0, 4)
    }));

    const healthSummary = {
      score: healthScore,
      level: healthLevel,
      label: healthLabel,
      narrative: healthLevel === 'healthy'
        ? '整体运营健康，当前重点是保持巡检和关注高峰预约变化。'
        : healthLevel === 'watch'
          ? '运营存在少量压力点，建议优先处理待办并关注风险设备。'
          : healthLevel === 'risk'
            ? '运营风险正在累积，建议先收敛故障、逾期和高风险设备。'
            : '运营处于高压状态，建议立即处理紧急事项并暂停高风险设备新增预约。',
      signals: [
        { key: 'top_risk_score', label: '最高设备风险分', value: topRiskScore, tone: topRiskScore >= 75 ? 'danger' : topRiskScore >= 45 ? 'warning' : 'success' },
        { key: 'pending_workload', label: '待处理工作量', value: pendingWorkload, tone: pendingWorkload >= 8 ? 'danger' : pendingWorkload >= 3 ? 'warning' : 'success' },
        { key: 'high_demand_slots', label: '高峰时段', value: highDemandSlots, tone: highDemandSlots >= 4 ? 'warning' : 'info' },
        { key: 'low_utilization_devices', label: '低利用设备', value: lowUtilizationCount, tone: lowUtilizationCount >= 3 ? 'warning' : 'info' }
      ]
    };

    const topDemandText = topDemand ? `高峰集中在周 ${topDemand.weekday} / ${topDemand.slot_key}（${topDemand.count} 单）` : '暂无明显高峰时段';
    const topRiskText = topRisk ? `${topRisk.device_name || topRisk.device_code} 风险分 ${topRisk.risk_score}` : '暂无明显高风险设备';
    const opsBriefing = `运营简报：当前健康分 ${healthScore}（${healthLabel}）。${topRiskText}；${topDemandText}；待处理工作 ${pendingWorkload} 项，其中预约审批 ${workload.pending_reservations || 0}、用户审核 ${workload.pending_users || 0}、故障 ${workload.pending_faults || 0}、逾期 ${workload.overdue_borrows || 0}。建议先处理“紧急处置”和“今日收口”队列。`;

    const roleFocus = [
      {
        role_key: 'super_admin',
        label: '超级管理员',
        focus: '看全局健康、权限边界和跨模块积压。',
        highlights: [`健康分 ${healthScore}`, `总待办 ${pendingWorkload}`, `风险设备 ${riskDeviceCount}`],
        action_url: '/admin/system'
      },
      {
        role_key: 'reservation_admin',
        label: '预约管理员',
        focus: '优先处理预约审批、逾期和高峰时段调度。',
        highlights: [`预约审批 ${workload.pending_reservations || 0}`, `逾期 ${workload.overdue_borrows || 0}`, `高峰时段 ${highDemandSlots}`],
        action_url: '/admin/reservations?status=pending'
      },
      {
        role_key: 'device_admin',
        label: '设备管理员',
        focus: '优先检查高风险设备、未处理故障和低利用设备。',
        highlights: [`故障待办 ${workload.pending_faults || 0}`, `最高风险分 ${topRiskScore}`, `低利用设备 ${lowUtilizationCount}`],
        action_url: '/admin/faults?status=pending'
      }
    ];

    return ok({
      generated_at: new Date().toISOString(),
      engine: {
        type: 'rules',
        version: '5.0.0',
        label: '可解释规则洞察',
        confidence_basis: '设备状态、故障、异常归还、逾期、预约量与待办量'
      },
      range: { start, end },
      summary: {
        risk_devices: riskDeviceCount,
        high_demand_slots: highDemandSlots,
        overdue_or_abnormal: overdueOrAbnormal,
        pending_workload: pendingWorkload,
        low_utilization_devices: lowUtilizationCount,
        health_score: healthScore
      },
      ops_briefing: opsBriefing,
      health_summary: healthSummary,
      action_groups: actionGroups,
      next_actions: nextActionsWithExecution,
      role_focus: roleFocus,
      recommendations,
      exception_reason_summary: exceptionReasonSummary,
      top_exception_reason: topExceptionReason,
      device_risks: normalizedRisks,
      demand_forecast: demandForecast,
      workload,
      low_utilization_devices: lowUtilizationRows
    });
  }

  return {
    adminAnalyticsDeviceUsage,
    adminAnalyticsFaults,
    adminAnalyticsIntelligence,
    adminAnalyticsOverview,
    adminAnalyticsTimeHeatmap,
    adminListIntelligenceActionLogs,
    adminUpdateIntelligenceAction,
    usageStats
  };
}

module.exports = { createAnalyticsService };

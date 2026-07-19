function createReservationReadService(context = {}) {
  const {
    activeReservationStatus,
    addNamesToReservations,
    applyReservationVisibility,
    assertText,
    calendarColor,
    calendarRange,
    currentReservationDateCondition,
    fail,
    getById,
    getReservationVisibilityConfig,
    historicalReservationTimeCondition,
    includePastReservations,
    nowIso,
    ok,
    query,
    queryOne,
    requireAdminRole,
    requireUser
  } = context;

  function calendarServerMeta(serverNow = nowIso()) {
    const serverDate = new Date(serverNow);
    const safeDate = Number.isNaN(serverDate.getTime()) ? new Date() : serverDate;
    return {
      server_now: serverNow,
      server_today: new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(safeDate),
      server_timezone: 'Asia/Shanghai'
    };
  }

  async function getCalendarEvents(params = {}, token) {
    let fullAccess = false;
    try {
      await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['reservation.view', 'device.view', 'stats.view']);
      fullAccess = true;
    } catch (_) {
      await requireUser(token);
    }

    const { start, end } = calendarRange(params);
    const serverNow = nowIso();
    const serverMeta = calendarServerMeta(serverNow);
    const visibility = fullAccess ? { showName: true, showPhone: true, showStudentNo: true } : await getReservationVisibilityConfig();
    const rows = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        b.purpose,
        d.device_code, d.name as device_name,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.status = any($1) and ri.start_time < $3 and ri.end_time > $2
      order by ri.start_time asc
    `, [activeReservationStatus, start, end]);
    const borrowRows = await query(`
      select b.*, d.device_code, d.name as device_name, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from borrow_records b
      join devices d on d.id = b.device_id
      join users u on u.id = b.user_id
      where b.reservation_id is null and b.status = any($1) and b.borrow_time < $3 and coalesce(b.expected_return_time, b.return_time, now()) > $2
      order by b.borrow_time asc
    `, [['in_use', 'abnormal_pending', 'overdue'], start, end]);

    const reservationEvents = rows.map((row) => {
      const visible = applyReservationVisibility(row, visibility, fullAccess);
      return {
        id: row.id,
        event_id: row.item_id || row.id,
        item_id: row.item_id,
        reservation_id: row.reservation_id || row.id,
        type: 'reservation_item',
        source_type: 'reservation',
        status: row.status,
        title: `${row.device_code} ${row.device_name}`,
        device_id: row.device_id,
        device_code: row.device_code,
        device_name: row.device_name,
        user_id: visible.user_name ? row.user_id : '',
        user_name: visible.user_name,
        user_phone: visible.user_phone,
        user_student_no: visible.user_student_no,
        start_time: row.start_time,
        end_time: row.end_time,
        purpose: row.purpose || '',
        color: calendarColor(row.device_code)
      };
    });
    const borrowEvents = borrowRows.map((row) => {
      const visible = applyReservationVisibility(row, visibility, fullAccess);
      return {
        id: row.id,
        event_id: row.id,
        record_id: row.id,
        type: 'borrow',
        source_type: 'borrow',
        status: row.status,
        title: `${row.device_code} ${row.device_name}`,
        device_id: row.device_id,
        device_code: row.device_code,
        device_name: row.device_name,
        user_id: visible.user_name ? row.user_id : '',
        user_name: visible.user_name,
        user_phone: visible.user_phone,
        user_student_no: visible.user_student_no,
        start_time: row.borrow_time,
        end_time: row.expected_return_time || row.return_time || serverNow,
        purpose: '现场借用',
        color: calendarColor(row.device_code)
      };
    });
    return ok({ events: [...reservationEvents, ...borrowEvents], range: { start, end }, full_access: fullAccess, ...serverMeta });
  }

  async function getCalendarDay(params = {}, token) {
    const date = assertText(params.date || params.reservation_date, 'date', 20).slice(0, 10);
    const start = `${date}T00:00:00+08:00`;
    const end = `${date}T23:59:59+08:00`;
    return getCalendarEvents({ start: start.slice(0, 10), end: end.slice(0, 10) }, token);
  }

  async function adminListReservations(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['reservation.approve', 'reservation.view', 'reservation.change_plan']);
    const scope = String(params.scope || params.view || '').trim().toLowerCase();
    const historyScope = ['history', 'past', 'completed'].includes(scope);
    const currentScope = ['current', 'active'].includes(scope);
    let where = '';
    if (historyScope) where = `where ${historicalReservationTimeCondition('ri')}`;
    else if (currentScope) where = `where ${currentReservationDateCondition('ri')}`;
    else if (!includePastReservations(params)) where = `where ri.status = 'pending' and ${currentReservationDateCondition('ri')}`;
    const data = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        b.purpose,
        d.device_code, d.name as device_name,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      ${where}
      order by ri.start_time asc, ri.created_at desc
    `);
    return ok({ reservations: await addNamesToReservations(data || []) });
  }

  async function listReservationBatches(params = {}, token) {
    const user = await requireUser(token);
    const rows = await query(`
      select b.*,
        count(ri.id)::int as item_count,
        count(distinct ri.device_id)::int as device_count,
        count(distinct (ri.start_time at time zone 'Asia/Shanghai')::date)::int as date_count,
        string_agg(distinct d.name, '、') as device_names,
        min(ri.start_time) as first_start_time,
        max(ri.end_time) as last_end_time,
        count(*) filter (where ri.status='approved')::int as approved_count,
        count(*) filter (where ri.status='in_use')::int as in_use_count
      from reservation_batches b
      left join reservation_items ri on ri.batch_id = b.id and ri.deleted_at is null
      left join devices d on d.id = ri.device_id
      where b.user_id = $1
      group by b.id
      order by b.created_at desc
    `, [user.id]);
    return ok({ batches: rows || [] });
  }

  async function getReservationBatch(params = {}, token) {
    const user = await requireUser(token);
    const batchId = assertText(params.id || params.batch_id || params.batchId, 'batch_id', 60);
    const batch = await getById('reservation_batches', batchId);
    if (!batch) return fail('预约批次不存在。', 404, 3004);
    if (batch.user_id !== user.id && !['admin', 'super_admin'].includes(user.role)) return fail('不能查看其他用户的预约。', 403, 1003);
    const reservations = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        d.device_code, d.name as device_name, d.status as device_status, d.allow_reservation,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.batch_id = $1
      order by ri.start_time asc
    `, [batchId]);
    return ok({ batch, items: reservations, reservations });
  }

  async function adminListReservationBatches(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['reservation.approve', 'reservation.view', 'reservation.change_plan']);
    const status = String(params.status || '').trim();
    const scope = String(params.scope || params.view || '').trim().toLowerCase();
    const historyScope = ['history', 'past', 'completed'].includes(scope);
    const currentScope = ['current', 'active'].includes(scope);
    const includePast = includePastReservations(params);
    const clauses = [];
    const values = [];
    if (status) { values.push(status); clauses.push(`b.status = $${values.length}`); }
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const statusScopeCondition = historyScope
      ? historicalReservationTimeCondition('ri')
      : (currentScope || !includePast ? currentReservationDateCondition('ri') : 'true');
    let having = '';
    if (historyScope) {
      having = `having count(ri.id) > 0 and bool_and(${historicalReservationTimeCondition('ri')})`;
    } else if (currentScope) {
      having = `having count(*) filter (where ${currentReservationDateCondition('ri')}) > 0`;
    } else if (!includePast) {
      having = `having count(*) filter (where ri.status = 'pending' and ${currentReservationDateCondition('ri')}) > 0`;
    }
    const rows = await query(`
      select b.*, u.name as user_name, u.phone as user_phone,
        string_agg(distinct d.name, '、') filter (where ${statusScopeCondition}) as device_names,
        string_agg(distinct d.device_code, '、') filter (where ${statusScopeCondition}) as device_codes,
        string_agg(distinct (d.name || '｜' || d.device_code || '｜' || to_char(ri.start_time at time zone 'Asia/Shanghai', 'YYYY/MM/DD HH24:MI') || ' - ' || to_char(ri.end_time at time zone 'Asia/Shanghai', 'HH24:MI')), ';;') filter (where ${statusScopeCondition}) as reservation_preview_rows,
        string_agg(distinct (to_char(ri.start_time at time zone 'Asia/Shanghai', 'YYYY/MM/DD HH24:MI') || ' - ' || to_char(ri.end_time at time zone 'Asia/Shanghai', 'HH24:MI')), ';;') filter (where ${statusScopeCondition}) as reservation_times,
        min(ri.start_time) filter (where ${statusScopeCondition}) as first_start_time,
        max(ri.end_time) filter (where ${statusScopeCondition}) as last_end_time,
        count(*) filter (where ${statusScopeCondition})::int as item_count,
        count(distinct ri.device_id) filter (where ${statusScopeCondition})::int as device_count,
        count(distinct (ri.start_time at time zone 'Asia/Shanghai')::date) filter (where ${statusScopeCondition})::int as date_count,
        count(*) filter (where ${currentReservationDateCondition('ri')})::int as current_item_count,
        count(*) filter (where ${historicalReservationTimeCondition('ri')})::int as history_item_count,
        bool_or(${currentReservationDateCondition('ri')}) as has_current_item,
        bool_and(${historicalReservationTimeCondition('ri')}) as is_history,
        count(*) filter (where ri.status = 'pending' and ${statusScopeCondition})::int as pending_count,
        count(*) filter (where ri.status = 'approved' and ${statusScopeCondition})::int as approved_count,
        count(*) filter (where ri.status = 'rejected' and ${statusScopeCondition})::int as rejected_count
      from reservation_batches b
      join users u on u.id = b.user_id
      join reservation_items ri on ri.batch_id = b.id
      join devices d on d.id = ri.device_id
      ${where}
      group by b.id, u.name, u.phone
      ${having}
      order by b.created_at desc
    `, values);
    return ok({ batches: rows || [] });
  }

  function approvalLevelScore(level) {
    if (level === 'danger') return 35;
    if (level === 'warning') return 18;
    if (level === 'info') return 4;
    return 0;
  }

  function approvalItem(level, type, message, extra = {}) {
    return {
      level,
      type,
      message,
      score: approvalLevelScore(level),
      ...extra
    };
  }

  function approvalActionFromRisk(level, riskItems = []) {
    if (riskItems.some((item) => item.level === 'danger' && ['device_unavailable', 'borrow_conflict', 'time_conflict'].includes(item.type))) return 'reject_or_hold';
    if (level === 'danger' || level === 'warning') return 'manual_review';
    return 'approve';
  }

  function approvalActionLabel(action) {
    if (action === 'reject_or_hold') return '建议暂缓';
    if (action === 'manual_review') return '需人工复核';
    return '可过';
  }

  function slotText(slotKey) {
    return ({ morning: '上午', afternoon: '下午', evening: '晚上', night: '夜间', daytime: '白天', custom: '自定义' })[slotKey] || slotKey || '未命名时段';
  }

  async function adminGetReservationBatch(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['reservation.approve', 'reservation.view', 'reservation.change_plan']);
    const batchId = assertText(params.id || params.batch_id || params.batchId, 'batch_id', 60);
    const scope = String(params.scope || params.view || '').trim().toLowerCase();
    const historyScope = ['history', 'past', 'completed'].includes(scope);
    const currentScope = ['current', 'active'].includes(scope);
    const includePast = includePastReservations(params);
    let reservationDateWhere = '';
    if (historyScope) reservationDateWhere = ` and ${historicalReservationTimeCondition('ri')}`;
    else if (currentScope || !includePast) reservationDateWhere = ` and ${currentReservationDateCondition('ri')}`;
    const batch = await queryOne('select b.*, u.name as user_name, u.phone as user_phone, u.student_no as user_student_no from reservation_batches b join users u on u.id = b.user_id where b.id = $1', [batchId]);
    if (!batch) return fail('预约批次不存在。', 404, 3004);
    const reservations = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        extract(isodow from ri.start_time at time zone 'Asia/Shanghai')::int as start_weekday,
        d.device_code, d.name as device_name, d.status as device_status, d.allow_reservation,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.batch_id = $1${reservationDateWhere}
      order by ri.start_time asc
    `, [batchId]);
    const itemIds = (reservations || []).map((row) => row.id).filter(Boolean);
    const approvalLogs = await query(`
      select id, action, detail, operator_id, operator_name,
        case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'operation_logs' and column_name = 'target_id'
        ) then to_jsonb(operation_logs)->>'target_id' else null end as target_id,
        record_id,
        created_at
      from operation_logs
      where action = any($1)
        and (
          case when exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'operation_logs' and column_name = 'target_id'
          ) then to_jsonb(operation_logs)->>'target_id' else null end = $2
          or record_id::text = $2
          or (${itemIds.length ? 'record_id = any($3::uuid[])' : 'false'})
        )
      order by created_at desc
      limit 50
    `, itemIds.length ? [['approve_reservation_batch', 'reject_reservation_batch', 'approve_reservation', 'reject_reservation'], batchId, itemIds] : [['approve_reservation_batch', 'reject_reservation_batch', 'approve_reservation', 'reject_reservation'], batchId]);
    const riskItems = [];
    const insightItems = [];
    const pendingItems = (reservations || []).filter((row) => row.status === 'pending');
    const deviceIds = [...new Set(pendingItems.map((row) => row.device_id).filter(Boolean))];
    const deviceMetricRows = deviceIds.length ? await query(`
      with fault_rows as (
        select device_id,
          count(*)::int as fault_count,
          count(*) filter (where severity in ('high','critical','danger'))::int as high_fault_count,
          count(*) filter (where status in ('pending','processing'))::int as open_fault_count
        from device_fault_reports
        where device_id = any($1::uuid[]) and created_at >= now() - interval '30 days'
        group by device_id
      ), borrow_rows as (
        select device_id,
          count(*) filter (where is_overdue = true or status = 'overdue')::int as overdue_count,
          count(*) filter (where return_condition is not null and return_condition <> 'normal')::int as abnormal_return_count
        from borrow_records
        where device_id = any($1::uuid[]) and borrow_time >= now() - interval '90 days'
        group by device_id
      )
      select d.id as device_id,
        coalesce(f.fault_count, 0)::int as fault_count,
        coalesce(f.high_fault_count, 0)::int as high_fault_count,
        coalesce(f.open_fault_count, 0)::int as open_fault_count,
        coalesce(b.overdue_count, 0)::int as overdue_count,
        coalesce(b.abnormal_return_count, 0)::int as abnormal_return_count,
        least(100,
          coalesce(f.fault_count, 0) * 16
          + coalesce(f.high_fault_count, 0) * 18
          + coalesce(f.open_fault_count, 0) * 12
          + coalesce(b.overdue_count, 0) * 14
          + coalesce(b.abnormal_return_count, 0) * 12
          + case when d.status in ('abnormal_pending','maintenance') then 25 when d.status = 'in_use' then 5 else 0 end
        )::int as risk_score
      from devices d
      left join fault_rows f on f.device_id = d.id
      left join borrow_rows b on b.device_id = d.id
      where d.id = any($1::uuid[])
    `, [deviceIds]) : [];
    const deviceMetrics = new Map((deviceMetricRows || []).map((row) => [String(row.device_id), row]));
    const demandRows = await query(`
      select extract(isodow from start_time at time zone 'Asia/Shanghai')::int as weekday,
        slot_key,
        count(*)::int as count
      from reservation_items
      where batch_id <> $1
        and start_time >= now() - interval '90 days'
        and status in ('pending','approved','in_use','completed')
      group by 1, 2
    `, [batchId]);
    const demandMap = new Map((demandRows || []).map((row) => [`${row.weekday}:${row.slot_key || 'custom'}`, Number(row.count || 0)]));
    const maxDemand = Math.max(0, ...(demandRows || []).map((row) => Number(row.count || 0)));
    const userHistory = await queryOne(`
      select
        (select count(*)::int from reservation_items where user_id = $1 and start_time >= now() - interval '90 days' and status in ('no_show','cancelled','rejected')) as reservation_exceptions,
        (select count(*)::int from borrow_records where user_id = $1 and borrow_time >= now() - interval '90 days' and (is_overdue = true or status in ('overdue','abnormal_pending') or (return_condition is not null and return_condition <> 'normal'))) as borrow_exceptions,
        (select count(*)::int from device_fault_reports where user_id = $1 and created_at >= now() - interval '90 days') as fault_reports
    `, [batch.user_id]) || { reservation_exceptions: 0, borrow_exceptions: 0, fault_reports: 0 };

    for (const item of pendingItems) {
      const base = {
        item_id: item.id,
        device_code: item.device_code,
        device_name: item.device_name,
        start_time: item.start_time,
        end_time: item.end_time,
        action_url: '/admin/reservations'
      };
      if (!item.allow_reservation || ['maintenance', 'disabled', 'abnormal_pending'].includes(item.device_status)) {
        riskItems.push(approvalItem('danger', 'device_unavailable', `${item.device_code || '设备'}不可约`, {
          ...base,
          device_status: item.device_status,
          allow_reservation: !!item.allow_reservation,
          evidence: [item.device_status || '未知', item.allow_reservation ? '可约' : '不可约']
        }));
      }
      const metric = deviceMetrics.get(String(item.device_id)) || {};
      const deviceRiskScore = Number(metric.risk_score || 0);
      if (deviceRiskScore >= 70 || Number(metric.open_fault_count || 0) > 0 || Number(metric.high_fault_count || 0) > 0) {
        riskItems.push(approvalItem(deviceRiskScore >= 70 ? 'danger' : 'warning', 'device_risk_score', `${item.device_code || '设备'}风险${deviceRiskScore}`, {
          ...base,
          risk_score: deviceRiskScore,
          evidence: [
            `故障${Number(metric.fault_count || 0)}`,
            `未处理${Number(metric.open_fault_count || 0)}`,
            `逾期${Number(metric.overdue_count || 0)}`
          ]
        }));
      }
      const demandCount = demandMap.get(`${item.start_weekday || ''}:${item.slot_key || 'custom'}`) || 0;
      const isPeak = demandCount >= 3 && (maxDemand <= 0 || demandCount / maxDemand >= 0.65);
      if (isPeak) {
        insightItems.push(approvalItem('info', 'peak_slot', `高峰 周${item.start_weekday || '—'} ${slotText(item.slot_key)} · ${demandCount}次`, {
          ...base,
          demand_count: demandCount,
          evidence: ['高峰时段']
        }));
      }
      const conflictRows = await query(`
        select ri.id, ri.batch_id, ri.status, ri.start_time, ri.end_time, u.name as user_name
        from reservation_items ri
        join users u on u.id = ri.user_id
        where ri.device_id = $1
          and ri.batch_id <> $2
          and ri.status = any($5)
          and ri.start_time < $4
          and ri.end_time > $3
        order by ri.start_time asc
        limit 5
      `, [item.device_id, batchId, item.start_time, item.end_time, activeReservationStatus]);
      for (const conflict of conflictRows || []) {
        riskItems.push(approvalItem(conflict.status === 'approved' || conflict.status === 'in_use' ? 'danger' : 'warning', 'time_conflict', `${item.device_code || '设备'}时段冲突`, {
          ...base,
          conflict_item_id: conflict.id,
          conflict_batch_id: conflict.batch_id,
          conflict_status: conflict.status,
          conflict_start_time: conflict.start_time,
          conflict_end_time: conflict.end_time,
          evidence: [conflict.user_name || '—', conflict.status]
        }));
      }
      const borrowRows = await query(`
        select br.id, br.status, br.borrow_time, br.expected_return_time, u.name as user_name
        from borrow_records br
        join users u on u.id = br.user_id
        where br.device_id = $1
          and br.status = any($4)
          and br.borrow_time < $3
          and coalesce(br.expected_return_time, br.return_time, now()) > $2
        order by br.borrow_time asc
        limit 5
      `, [item.device_id, item.start_time, item.end_time, ['in_use', 'abnormal_pending', 'overdue']]);
      for (const borrow of borrowRows || []) {
        riskItems.push(approvalItem('danger', 'borrow_conflict', `${item.device_code || '设备'}仍在借用`, {
          ...base,
          borrow_record_id: borrow.id,
          borrow_status: borrow.status,
          evidence: [borrow.user_name || '—', borrow.status]
        }));
      }
    }
    const unfinishedBorrowRows = await query(`
      select id, status, device_id, borrow_time, expected_return_time
      from borrow_records
      where user_id = $1 and status = any($2)
      order by borrow_time desc
      limit 5
    `, [batch.user_id, ['in_use', 'abnormal_pending', 'overdue']]);
    for (const borrow of unfinishedBorrowRows || []) {
      riskItems.push(approvalItem(borrow.status === 'overdue' || borrow.status === 'abnormal_pending' ? 'danger' : 'warning', 'user_unfinished_borrow', `未完成借用`, {
        borrow_record_id: borrow.id,
        borrow_status: borrow.status,
        borrow_time: borrow.borrow_time,
        expected_return_time: borrow.expected_return_time,
        evidence: [`借用开始：${borrow.borrow_time || '—'}`, `预计归还：${borrow.expected_return_time || '—'}`]
      }));
    }
    const userExceptionCount = Number(userHistory.reservation_exceptions || 0) + Number(userHistory.borrow_exceptions || 0);
    if (userExceptionCount > 0) {
      riskItems.push(approvalItem(userExceptionCount >= 3 ? 'warning' : 'info', 'user_history', `近90天异常${userExceptionCount}`, {
        user_id: batch.user_id,
        evidence: [
          `预约异常${Number(userHistory.reservation_exceptions || 0)}`,
          `借还异常${Number(userHistory.borrow_exceptions || 0)}`,
          `故障${Number(userHistory.fault_reports || 0)}`
        ]
      }));
    }
    const allSignals = [...riskItems, ...insightItems];
    const dangerCount = riskItems.filter((item) => item.level === 'danger').length;
    const warningCount = riskItems.filter((item) => item.level === 'warning').length;
    const infoCount = allSignals.filter((item) => item.level === 'info').length;
    const riskLevel = dangerCount ? 'danger' : (warningCount ? 'warning' : 'safe');
    const riskScore = Math.min(100, riskItems.reduce((sum, item) => sum + Number(item.score || 0), 0));
    const action = approvalActionFromRisk(riskLevel, riskItems);
    const approvalRisk = {
      level: riskLevel,
      safe: riskLevel === 'safe',
      action,
      action_label: approvalActionLabel(action),
      risk_score: riskScore,
      confidence: pendingItems.length ? Math.max(55, Math.min(95, 70 + allSignals.length * 4)) : 50,
      signal_counts: { danger: dangerCount, warning: warningCount, info: infoCount },
      summary: riskLevel === 'safe'
        ? approvalActionLabel(action)
        : `${approvalActionLabel(action)} · 高风险${dangerCount} · 需复核${warningCount}`,
      recommendation: riskLevel === 'safe'
        ? '可正常审批'
        : '优先核对冲突、未归还与异常记录',
      items: allSignals.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    };
    return ok({ batch, items: reservations, reservations, approval_logs: approvalLogs || [], approval_risk: approvalRisk });
  }

  return {
    adminGetReservationBatch,
    adminListReservationBatches,
    adminListReservations,
    getCalendarDay,
    getCalendarEvents,
    getReservationBatch,
    listReservationBatches
  };
}

module.exports = { createReservationReadService };

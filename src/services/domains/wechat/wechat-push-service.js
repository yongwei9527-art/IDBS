const { AppError } = require('../../../lib/app-error');

const MAX_REPORT_PUSH_ROWS = 25;
const MAX_WECHAT_TEXT_LENGTH = 1800;

function createWechatPushService(context = {}) {
  const {
    assertText,
    fetch,
    formatDateForTimezone,
    formatDateTimeForTimezone,
    getReportConfig,
    getWechatConfig,
    maskOpenId,
    nowIso,
    ok,
    query,
    requireAdminRole,
    uuid
  } = context;

  async function getUsageLogRowsByDate(dateText, timeZone = 'Asia/Shanghai') {
    const targetDate = String(dateText || '').trim();
    const rows = await query('select * from usage_log order by borrow_time asc nulls last, created_at asc');
    return rows.filter((row) => formatDateForTimezone(new Date(row.created_at), timeZone) === targetDate);
  }

  async function logWechatPush(payload = {}) {
    try {
      await query('insert into wechat_push_logs (id, push_date, recipient_openid, message_type, message_preview, status, response_body, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)', [
        uuid(),
        String(payload.push_date || '').slice(0, 20),
        String(payload.recipient_openid || '').slice(0, 150),
        String(payload.message_type || 'daily_usage_report').slice(0, 50),
        String(payload.message_preview || '').slice(0, 1000),
        String(payload.status || 'unknown').slice(0, 30),
        String(payload.response_body || '').slice(0, 2000),
        nowIso()
      ]);
    } catch (error) {
      console.warn('写入微信推送日志失败：', error.message || error);
    }
  }


  function slotLabel(slotKey) {
    return ({ morning: '上午', afternoon: '下午', evening: '晚间', night: '夜间' })[slotKey] || slotKey || '未知时段';
  }

  function smartRecommendation(id, level, title, description, evidence = [], actionLabel = '') {
    return { id, level, title, description, evidence: evidence.filter(Boolean), action_label: actionLabel };
  }

  async function buildDailySmartInsights(dateText, timeZone = 'Asia/Shanghai') {
    const dayStartDate = new Date(String(dateText) + 'T00:00:00+08:00');
    const dayEndDate = new Date(dayStartDate.getTime() + 24 * 60 * 60 * 1000);
    const dayStart = dayStartDate.toISOString();
    const dayEnd = dayEndDate.toISOString();
    const recentStart = new Date(dayEndDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const workloadRows = await query([
      'select',
      "  (select count(*)::int from reservation_items where start_time >= $1 and start_time < $2 and status in ('pending','approved','in_use')) as today_reservations,",
      "  (select count(*)::int from reservation_items where status = 'pending') as pending_reservations,",
      "  (select count(*)::int from users where status = 'pending' and coalesce(is_banned, false) = false) as pending_users,",
      "  (select count(*)::int from device_fault_reports where status in ('pending','processing')) as pending_faults,",
      "  (select count(*)::int from borrow_records where status = 'in_use' and (is_overdue = true or expected_return_time < now())) as overdue_borrows"
    ].join('\n'), [dayStart, dayEnd]);
    const workload = workloadRows?.[0] || {};
    const normalizedWorkload = {
      today_reservations: Number(workload.today_reservations || 0),
      pending_reservations: Number(workload.pending_reservations || 0),
      pending_users: Number(workload.pending_users || 0),
      pending_faults: Number(workload.pending_faults || 0),
      overdue_borrows: Number(workload.overdue_borrows || 0)
    };

    const riskRows = await query([
      'with usage_rows as (',
      '  select device_id,',
      '    count(*)::int as usage_count,',
      "    count(*) filter (where return_condition is not null and return_condition <> 'normal')::int as abnormal_return_count,",
      "    count(*) filter (where is_overdue = true or (status = 'in_use' and expected_return_time < now()))::int as overdue_count",
      '  from borrow_records',
      '  where borrow_time >= $1 and borrow_time < $2',
      '  group by device_id',
      '), fault_rows as (',
      '  select device_id,',
      '    count(*)::int as fault_count,',
      "    count(*) filter (where severity in ('high','critical','danger'))::int as high_fault_count,",
      "    count(*) filter (where status in ('pending','processing'))::int as open_fault_count",
      '  from device_fault_reports',
      '  where created_at >= $1 and created_at < $2',
      '  group by device_id',
      ')',
      'select d.device_code,',
      '  d.name as device_name,',
      '  d.status,',
      '  coalesce(u.usage_count, 0)::int as usage_count,',
      '  coalesce(f.fault_count, 0)::int as fault_count,',
      '  coalesce(f.high_fault_count, 0)::int as high_fault_count,',
      '  coalesce(f.open_fault_count, 0)::int as open_fault_count,',
      '  coalesce(u.abnormal_return_count, 0)::int as abnormal_return_count,',
      '  coalesce(u.overdue_count, 0)::int as overdue_count,',
      '  least(100,',
      '    coalesce(f.fault_count, 0) * 18',
      '    + coalesce(f.high_fault_count, 0) * 16',
      '    + coalesce(f.open_fault_count, 0) * 10',
      '    + coalesce(u.abnormal_return_count, 0) * 12',
      '    + coalesce(u.overdue_count, 0) * 10',
      "    + case when d.status in ('abnormal_pending','maintenance') then 25 when d.status = 'in_use' then 4 else 0 end",
      '  )::int as risk_score',
      'from devices d',
      'left join usage_rows u on u.device_id = d.id',
      'left join fault_rows f on f.device_id = d.id',
      "where d.status <> 'disabled'",
      'order by risk_score desc, fault_count desc, abnormal_return_count desc, d.device_code',
      'limit 12'
    ].join('\n'), [recentStart, dayEnd]);
    const deviceRisks = (riskRows || []).map((row) => ({
      ...row,
      risk_score: Number(row.risk_score || 0),
      fault_count: Number(row.fault_count || 0),
      abnormal_return_count: Number(row.abnormal_return_count || 0),
      overdue_count: Number(row.overdue_count || 0)
    }));

    const peakRows = await query([
      'select case',
      "    when (start_time at time zone 'Asia/Shanghai')::time >= time '08:00' and (start_time at time zone 'Asia/Shanghai')::time < time '12:00' then 'morning'",
      "    when (start_time at time zone 'Asia/Shanghai')::time >= time '12:00' and (start_time at time zone 'Asia/Shanghai')::time < time '17:00' then 'afternoon'",
      "    when (start_time at time zone 'Asia/Shanghai')::time >= time '17:00' and (start_time at time zone 'Asia/Shanghai')::time < time '22:00' then 'evening'",
      "    else 'night'",
      '  end as slot_key,',
      '  count(*)::int as count',
      'from reservation_items',
      "where start_time >= $1 and start_time < $2 and status in ('pending','approved','in_use','completed')",
      'group by 1',
      'order by count desc, slot_key',
      'limit 4'
    ].join('\n'), [dayStart, dayEnd]);
    const peak_slots = (peakRows || []).map((row) => ({ ...row, count: Number(row.count || 0), label: slotLabel(row.slot_key) }));
    const highDemandSlots = peak_slots.filter((row) => row.count >= 2);
    const pendingWorkload = normalizedWorkload.pending_reservations + normalizedWorkload.pending_users + normalizedWorkload.pending_faults + normalizedWorkload.overdue_borrows;
    const overdueOrAbnormal = deviceRisks.reduce((sum, row) => sum + row.overdue_count + row.abnormal_return_count, 0);
    const riskDevices = deviceRisks.filter((row) => row.risk_score >= 45);

    const recommendations = [];
    const topRisk = riskDevices[0];
    if (topRisk) {
      recommendations.push(smartRecommendation(
        'risk-' + topRisk.device_code,
        topRisk.risk_score >= 75 ? 'danger' : 'warning',
        (topRisk.device_name || topRisk.device_code) + ' 风险偏高',
        topRisk.risk_score >= 75 ? '建议暂停新预约并优先安排复检维护。' : '建议加入今日巡检清单，审批前关注设备状态。',
        ['风险分 ' + topRisk.risk_score, '故障 ' + topRisk.fault_count + ' 次', '异常/逾期 ' + (topRisk.abnormal_return_count + topRisk.overdue_count) + ' 条'],
        '查看故障处理'
      ));
    }
    const topPeak = peak_slots[0];
    if (topPeak?.count > 0) {
      recommendations.push(smartRecommendation(
        'peak-' + topPeak.slot_key,
        topPeak.count >= 2 ? 'info' : 'success',
        '今日' + topPeak.label + '预约最集中',
        topPeak.count >= 2 ? '建议提前确认设备状态和值班安排，避免集中时段排队。' : '今日预约压力较低，按常规节奏处理即可。',
        ['预约 ' + topPeak.count + ' 单', '统计时区 ' + timeZone],
        '查看预约日历'
      ));
    }
    if (pendingWorkload > 0) {
      recommendations.push(smartRecommendation(
        'workload-pending',
        normalizedWorkload.pending_faults + normalizedWorkload.overdue_borrows > 0 ? 'warning' : 'info',
        '待处理工作需要收口',
        '建议先处理逾期借用和故障，再处理预约审批与用户审核。',
        ['预约审批 ' + normalizedWorkload.pending_reservations, '故障 ' + normalizedWorkload.pending_faults, '逾期 ' + normalizedWorkload.overdue_borrows],
        '打开后台待办'
      ));
    }
    if (!recommendations.length) {
      recommendations.push(smartRecommendation('stable', 'success', '运营态势平稳', '未发现高风险设备、集中高峰或未收口待办。', ['保持常规巡检'], '保持关注'));
    }

    return {
      generated_at: new Date().toISOString(),
      date: dateText,
      timeZone,
      summary: {
        risk_devices: riskDevices.length,
        high_demand_slots: highDemandSlots.length,
        overdue_or_abnormal: overdueOrAbnormal,
        pending_workload: pendingWorkload,
        today_reservations: normalizedWorkload.today_reservations
      },
      workload: normalizedWorkload,
      device_risks: deviceRisks,
      peak_slots,
      recommendations: recommendations.slice(0, 4)
    };
  }

  function smartInsightLines(insights) {
    const summary = insights.summary || {};
    const lines = [
      '智能运营解读',
      '风险设备：' + (summary.risk_devices || 0) + ' 台；高峰时段：' + (summary.high_demand_slots || 0) + ' 个；待办：' + (summary.pending_workload || 0) + ' 项；逾期/异常：' + (summary.overdue_or_abnormal || 0) + ' 条。'
    ];
    (insights.recommendations || []).slice(0, 3).forEach((item, index) => {
      lines.push((index + 1) + '. ' + item.title);
      lines.push('   建议：' + item.description);
      if (item.evidence?.length) lines.push('   依据：' + item.evidence.slice(0, 3).join('；'));
    });
    return lines;
  }

  async function buildDailyUsageReport(payload = {}) {
    const reportConfig = await getReportConfig();
    const timeZone = String(payload.timezone || reportConfig.admin_report_timezone || 'Asia/Shanghai');
    const inputDate = String(payload.date || '').trim();
    const baseDate = inputDate ? new Date(`${inputDate}T00:00:00+08:00`) : new Date();
    const targetDate = inputDate || formatDateForTimezone(new Date(baseDate.getTime() - 24 * 60 * 60 * 1000), timeZone);
    const rows = await getUsageLogRowsByDate(targetDate, timeZone);
    const smartInsights = await buildDailySmartInsights(targetDate, timeZone);
    const smartLines = smartInsightLines(smartInsights);
    if (!rows.length) {
      const lines = [`【${targetDate}】设备使用记录日报`, '─────────────────', '当天没有新增使用记录。', '', ...smartLines, '─────────────────', `统计时区：${timeZone}`, `生成时间：${formatDateTimeForTimezone(new Date(), timeZone)}`];
      return { date: targetDate, count: 0, timeZone, intelligence_summary: smartInsights.summary, smart_insights: smartInsights, message: lines.join('\n').slice(0, MAX_WECHAT_TEXT_LENGTH) };
    }
    const lines = [`【${targetDate}】设备使用记录日报`, '─────────────────', `新增记录：${rows.length} 条`, '', ...smartLines, '─────────────────', '使用记录明细', ''];
    rows.slice(0, MAX_REPORT_PUSH_ROWS).forEach((row, index) => {
      const duration = row.duration_minutes ? `${row.duration_minutes} 分钟` : '进行中';
      lines.push(`${index + 1}. ${row.device_name || row.device_code || '设备'}`);
      lines.push(`   操作：${row.action || '-'}`);
      lines.push(`   用户：${row.user_name || '-'} ${row.user_student_no ? `(${row.user_student_no})` : ''}`.trim());
      lines.push(`   借出：${formatDateTimeForTimezone(row.borrow_time, timeZone)}`);
      lines.push(`   归还：${row.return_time ? formatDateTimeForTimezone(row.return_time, timeZone) : '未归还'}`);
      lines.push(`   时长：${duration}`);
      lines.push(`   状态：${row.record_status || '-'}`);
      if (row.return_condition && row.return_condition !== 'normal') {
        lines.push(`   异常：${row.return_condition}`);
      }
      lines.push('');
    });
    if (rows.length > MAX_REPORT_PUSH_ROWS) {
      lines.push(`还有 ${rows.length - MAX_REPORT_PUSH_ROWS} 条记录未在微信消息中展开，请进入后台查看完整总表。`);
      lines.push('');
    }
    lines.push('─────────────────');
    lines.push('说明：本日报用于覆盖昨日关注焦点，旧消息不会被微信撤回。');
    lines.push(`统计时区：${timeZone}`);
    lines.push(`生成时间：${formatDateTimeForTimezone(new Date(), timeZone)}`);
    return { date: targetDate, count: rows.length, timeZone, rows, intelligence_summary: smartInsights.summary, smart_insights: smartInsights, message: lines.join('\n').slice(0, MAX_WECHAT_TEXT_LENGTH) };
  }

  async function getWechatAccessToken(payload = {}) {
    const wechatConfig = await getWechatConfig();
    const appId = String(payload.appId || wechatConfig.wechat_app_id || '').trim();
    const appSecret = String(payload.appSecret || wechatConfig.wechat_app_secret || '').trim();
    if (!appId || !appSecret) {
      throw new AppError('微信推送配置不完整。', { status: 500, code: 5000 });
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      throw new AppError('获取微信访问凭证失败，请稍后重试。', { status: 500, code: 5000 });
    }
    return data.access_token;
  }

  async function sendWechatCustomMessage(payload = {}) {
    const recipientOpenId = assertText(payload.openid, 'openid', 150);
    const content = assertText(payload.content, 'content', MAX_WECHAT_TEXT_LENGTH);
    const accessToken = await getWechatAccessToken(payload);
    const response = await fetch(`https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ touser: recipientOpenId, msgtype: 'text', text: { content } }) });
    const data = await response.json();
    if (!response.ok || data.errcode) {
      throw new AppError('发送微信消息失败，请稍后重试。', { status: 500, code: 5000 });
    }
    return data;
  }

  async function pushDailyUsageReport(payload = {}) {
    const wechatConfig = await getWechatConfig();
    const openids = Array.isArray(payload.openids)
      ? payload.openids
      : String(payload.openids || wechatConfig.wechat_admin_openids || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!openids.length) {
      return ok({ sent: 0, skipped: true, reason: 'No admin openids configured' });
    }
    const report = await buildDailyUsageReport(payload);
    const results = [];
    for (const openid of openids) {
      try {
        const response = await sendWechatCustomMessage({ openid, content: report.message, appId: payload.appId, appSecret: payload.appSecret });
        await logWechatPush({ push_date: report.date, recipient_openid: openid, message_preview: report.message.slice(0, 1000), status: 'success', response_body: JSON.stringify(response) });
        results.push({ openid: maskOpenId(openid), success: true });
      } catch (error) {
        await logWechatPush({ push_date: report.date, recipient_openid: openid, message_preview: report.message.slice(0, 1000), status: 'failed', response_body: error.message || String(error) });
        results.push({ openid: maskOpenId(openid), success: false, message: error.message });
      }
    }
    return ok({ report_date: report.date, message: report.message, intelligence_summary: report.intelligence_summary, smart_insights: report.smart_insights, sent: results.filter((item) => item.success).length, failed: results.filter((item) => !item.success).length, results });
  }

  async function adminPreviewDailyUsageReport(payload, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view']);
    return ok(await buildDailyUsageReport(payload || {}));
  }

  async function adminSendDailyUsageReport(payload, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['stats.export']);
    return pushDailyUsageReport(payload || {});
  }

  return {
    adminPreviewDailyUsageReport,
    adminSendDailyUsageReport,
    buildDailyUsageReport,
    getUsageLogRowsByDate,
    getWechatAccessToken,
    logWechatPush,
    pushDailyUsageReport,
    sendWechatCustomMessage
  };
}

module.exports = {
  createWechatPushService,
  MAX_REPORT_PUSH_ROWS,
  MAX_WECHAT_TEXT_LENGTH
};


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
      console.warn('Failed to write wechat_push_logs:', error.message || error);
    }
  }

  async function buildDailyUsageReport(payload = {}) {
    const reportConfig = await getReportConfig();
    const timeZone = String(payload.timezone || reportConfig.admin_report_timezone || 'Asia/Shanghai');
    const inputDate = String(payload.date || '').trim();
    const baseDate = inputDate ? new Date(`${inputDate}T00:00:00+08:00`) : new Date();
    const targetDate = inputDate || formatDateForTimezone(new Date(baseDate.getTime() - 24 * 60 * 60 * 1000), timeZone);
    const rows = await getUsageLogRowsByDate(targetDate, timeZone);
    if (!rows.length) {
      return { date: targetDate, count: 0, timeZone, message: `【${targetDate}】设备使用记录日报\n\n当天没有新增使用记录。\n\n统计时区：${timeZone}\n生成时间：${formatDateTimeForTimezone(new Date(), timeZone)}` };
    }
    const lines = [`【${targetDate}】设备使用记录日报`, '─────────────────', `新增记录：${rows.length} 条`, '─────────────────', ''];
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
    return { date: targetDate, count: rows.length, timeZone, rows, message: lines.join('\n').slice(0, MAX_WECHAT_TEXT_LENGTH) };
  }

  async function getWechatAccessToken(payload = {}) {
    const wechatConfig = await getWechatConfig();
    const appId = String(payload.appId || wechatConfig.wechat_app_id || '').trim();
    const appSecret = String(payload.appSecret || wechatConfig.wechat_app_secret || '').trim();
    if (!appId || !appSecret) {
      throw new AppError('WECHAT_APP_ID or WECHAT_APP_SECRET is missing', { status: 500, code: 5000 });
    }
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      throw new AppError(`Failed to get WeChat access token: ${data.errmsg || response.statusText}`, { status: 500, code: 5000 });
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
      throw new AppError(`Failed to send WeChat message: ${data.errmsg || response.statusText}`, { status: 500, code: 5000 });
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
    return ok({ report_date: report.date, message: report.message, sent: results.filter((item) => item.success).length, failed: results.filter((item) => !item.success).length, results });
  }

  async function adminPreviewDailyUsageReport(payload, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'ops', 'auditor'], ['stats.view']);
    return ok(await buildDailyUsageReport(payload || {}));
  }

  async function adminSendDailyUsageReport(payload, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['stats.view']);
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

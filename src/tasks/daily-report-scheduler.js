function scheduleDailyUsageReport({ service, config }) {
  const fallbackDelayMs = 5 * 60 * 1000;
  let timer = null;
  let stopped = false;

  const planNext = async () => {
    if (stopped) return;

    try {
      const reportConfig = await service.getReportConfig();
      if (!reportConfig.admin_report_enabled) {
        timer = setTimeout(planNext, fallbackDelayMs);
        return;
      }

      const timeZone = reportConfig.admin_report_timezone || 'Asia/Shanghai';
      const now = new Date();
      const nowInTimezone = new Date(now.toLocaleString('en-US', { timeZone }));
      const nextRun = new Date(nowInTimezone);
      nextRun.setHours(reportConfig.admin_report_hour, reportConfig.admin_report_minute, 0, 0);
      if (nextRun <= nowInTimezone) {
        nextRun.setDate(nextRun.getDate() + 1);
      }

      const delay = Math.max(10_000, nextRun.getTime() - nowInTimezone.getTime());
      console.log(`Next daily usage report scheduled in ${Math.round(delay / 1000)}s (${timeZone} ${reportConfig.admin_report_hour}:${String(reportConfig.admin_report_minute).padStart(2, '0')})`);

      timer = setTimeout(async () => {
        try {
          await service.pushDailyUsageReport({
            appId: config.wechatAppId,
            appSecret: config.wechatAppSecret,
            openids: config.wechatAdminOpenids,
            timezone: timeZone
          });
          console.log('Daily usage report push executed');
        } catch (error) {
          console.error('Daily usage report push failed:', error);
        } finally {
          planNext().catch((planError) => {
            console.error('Failed to reschedule daily usage report:', planError);
            timer = setTimeout(planNext, fallbackDelayMs);
          });
        }
      }, delay);
    } catch (error) {
      console.error('Failed to schedule daily usage report:', error);
      timer = setTimeout(planNext, fallbackDelayMs);
    }
  };

  planNext().catch((error) => {
    console.error('Daily report scheduler bootstrap failed:', error);
  });

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

module.exports = { scheduleDailyUsageReport };

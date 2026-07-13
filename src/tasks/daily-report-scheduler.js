function scheduleDailyUsageReport({ service, db, intervalMs = 30_000, retryWindowMinutes = 10, logger = console, nowProvider = () => new Date() }) {
  let stopped = false;
  let timer = null;
  let lastRunKey = '';

  const tick = async () => {
    if (stopped) return;

    try {
      const reportConfig = await service.getReportConfig();
      if (!reportConfig.admin_report_enabled) return;

      const timeZone = reportConfig.admin_report_timezone || 'Asia/Shanghai';
      const now = nowProvider();
      const nowInTimezone = new Date(now.toLocaleString('en-US', { timeZone }));

      const scheduledHour = Number(reportConfig.admin_report_hour);
      const scheduledMinute = Number(reportConfig.admin_report_minute);
      const scheduledAt = new Date(nowInTimezone);
      scheduledAt.setHours(scheduledHour, scheduledMinute, 0, 0);
      if (scheduledAt.getTime() > nowInTimezone.getTime()) scheduledAt.setDate(scheduledAt.getDate() - 1);
      const delayMinutes = Math.floor((nowInTimezone.getTime() - scheduledAt.getTime()) / 60_000);
      if (delayMinutes < 0 || delayMinutes > retryWindowMinutes) {
        return;
      }

      const dayKey = scheduledAt.toISOString().slice(0, 10);
      const runKey = `${dayKey}-${scheduledHour}-${scheduledMinute}-${timeZone}`;
      if (lastRunKey === runKey) return;

      const jobKey = `daily-usage-report:${runKey}`;
      const claimed = db?.claimScheduledJob
        ? await db.claimScheduledJob({ key: jobKey, name: 'daily-usage-report', scheduledFor: now.toISOString() })
        : true;
      if (!claimed) return;
      try {
        await service.pushDailyUsageReport({ timezone: timeZone });
        await db?.completeScheduledJob?.(jobKey, 'success');
        lastRunKey = runKey;
        logger.log?.('Daily usage report push executed');
      } catch (error) {
        await db?.completeScheduledJob?.(jobKey, 'failed', error.message || String(error));
        throw error;
      }
    } catch (error) {
      logger.error?.('Daily usage report push failed:', error);
    }
  };

  timer = setInterval(() => {
    tick().catch((error) => {
      logger.error?.('Daily report scheduler tick failed:', error);
    });
  }, Math.max(10, Number(intervalMs) || 30_000));

  tick().catch((error) => {
    logger.error?.('Daily report scheduler bootstrap failed:', error);
  });

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    }
  };
}

module.exports = { scheduleDailyUsageReport };

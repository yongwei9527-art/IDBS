function scheduleDailyUsageReport({ service }) {
  let stopped = false;
  let timer = null;
  let lastRunKey = '';

  const tick = async () => {
    if (stopped) return;

    try {
      const reportConfig = await service.getReportConfig();
      if (!reportConfig.admin_report_enabled) return;

      const timeZone = reportConfig.admin_report_timezone || 'Asia/Shanghai';
      const now = new Date();
      const nowInTimezone = new Date(now.toLocaleString('en-US', { timeZone }));
      const hour = nowInTimezone.getHours();
      const minute = nowInTimezone.getMinutes();

      if (hour !== reportConfig.admin_report_hour || minute !== reportConfig.admin_report_minute) {
        return;
      }

      const dayKey = nowInTimezone.toISOString().slice(0, 10);
      const runKey = `${dayKey}-${hour}-${minute}-${timeZone}`;
      if (lastRunKey === runKey) return;

      lastRunKey = runKey;
      await service.pushDailyUsageReport({ timezone: timeZone });
      console.log('Daily usage report push executed');
    } catch (error) {
      console.error('Daily usage report push failed:', error);
    }
  };

  timer = setInterval(() => {
    tick().catch((error) => {
      console.error('Daily report scheduler tick failed:', error);
    });
  }, 60_000);

  tick().catch((error) => {
    console.error('Daily report scheduler bootstrap failed:', error);
  });

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    }
  };
}

module.exports = { scheduleDailyUsageReport };

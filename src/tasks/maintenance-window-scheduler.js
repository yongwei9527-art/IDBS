function scheduleMaintenanceWindows({ service, db, intervalMs = 60_000, logger = console, nowProvider = () => new Date() }) {
  let stopped = false;
  let timer = null;
  let running = false;

  const tick = async () => {
    if (stopped || running || typeof service?.runMaintenanceWindowLifecycle !== 'function') return;
    running = true;
    try {
      const now = nowProvider();
      const minuteKey = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const jobKey = `maintenance-window-lifecycle:${minuteKey}`;
      const claimed = db?.claimScheduledJob
        ? await db.claimScheduledJob({ key: jobKey, name: 'maintenance-window-lifecycle', scheduledFor: now.toISOString() })
        : true;
      if (!claimed) return;
      try {
        const result = await service.runMaintenanceWindowLifecycle(now.toISOString());
        await db?.completeScheduledJob?.(jobKey, 'success');
        if (result?.activated || result?.overdue_notifications) logger.log?.('Maintenance window lifecycle executed', result);
      } catch (error) {
        await db?.completeScheduledJob?.(jobKey, 'failed', error.message || String(error));
        throw error;
      }
    } catch (error) {
      logger.error?.('Maintenance window lifecycle failed:', error);
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    tick().catch((error) => logger.error?.('Maintenance scheduler tick failed:', error));
  }, Math.max(1000, Number(intervalMs) || 60_000));
  timer.unref?.();
  tick().catch((error) => logger.error?.('Maintenance scheduler bootstrap failed:', error));

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    }
  };
}

module.exports = { scheduleMaintenanceWindows };

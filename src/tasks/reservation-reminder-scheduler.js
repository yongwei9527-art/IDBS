function scheduleReservationReminders({ service, db, intervalMs = 60_000, logger = console, nowProvider = () => new Date() }) {
  let stopped = false; let running = false;
  const tick = async () => {
    if (stopped || running || typeof service?.runReservationReminderLifecycle !== 'function') return;
    running = true;
    try {
      const now = nowProvider(); const key = `reservation-reminders:${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
      if (db?.claimScheduledJob && !(await db.claimScheduledJob({ key, name: 'reservation-reminders', scheduledFor: now.toISOString() }))) return;
      const result = await service.runReservationReminderLifecycle(now.toISOString());
      await db?.completeScheduledJob?.(key, 'success');
      if (Object.values(result || {}).some(Boolean)) logger.log?.('Reservation reminders sent', result);
    } catch (error) { logger.error?.('Reservation reminder scheduler failed:', error); } finally { running = false; }
  };
  const timer = setInterval(() => { tick(); }, Math.max(1000, Number(intervalMs) || 60_000)); timer.unref?.(); tick();
  return { stop() { stopped = true; clearInterval(timer); } };
}
module.exports = { scheduleReservationReminders };

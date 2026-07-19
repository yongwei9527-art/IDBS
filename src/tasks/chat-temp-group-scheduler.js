function scheduleChatTempGroupCleanup({ service, intervalMs = 5 * 60 * 1000 } = {}) {
  if (!service?.cleanupExpiredTemporaryGroups && !service?.bootstrapSystem) {
    return { stop() {} };
  }

  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      if (typeof service.cleanupExpiredTemporaryGroups === 'function') {
        await service.cleanupExpiredTemporaryGroups();
      } else if (typeof service.bootstrapSystem === 'function') {
        await service.bootstrapSystem();
      }
    } catch (error) {
      console.warn('Chat temp group cleanup skipped:', error.message || error);
    } finally {
      running = false;
    }
  }

  // Run soon after boot, then periodically.
  const bootTimer = setTimeout(tick, 15_000);
  bootTimer.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return {
    stop() {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(timer);
    }
  };
}

module.exports = { scheduleChatTempGroupCleanup };

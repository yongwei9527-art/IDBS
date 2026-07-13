const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleMaintenanceWindows } = require('../../src/tasks/maintenance-window-scheduler');

test('maintenance scheduler claims a single lifecycle run across instances', async () => {
  const claimed = new Set();
  let runs = 0;
  const db = {
    async claimScheduledJob(job) { if (claimed.has(job.key)) return false; claimed.add(job.key); return true; },
    async completeScheduledJob() {}
  };
  const service = { async runMaintenanceWindowLifecycle() { runs += 1; return { activated: 0, overdue_notifications: 0 }; } };
  const first = scheduleMaintenanceWindows({ service, db, intervalMs: 10, logger: { log() {}, error() {} } });
  const second = scheduleMaintenanceWindows({ service, db, intervalMs: 10, logger: { log() {}, error() {} } });
  await new Promise((resolve) => setTimeout(resolve, 40));
  first.stop(); second.stop();
  assert.equal(runs, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleDailyUsageReport } = require('../../src/tasks/daily-report-scheduler');

test('daily report scheduler claims one shared run across instances', async () => {
  const timeZone = 'UTC';
  const nowInTimezone = new Date(new Date().toLocaleString('en-US', { timeZone }));
  const claimed = new Set();
  const completed = [];
  let pushes = 0;
  const db = {
    async claimScheduledJob(job) {
      if (claimed.has(job.key)) return false;
      claimed.add(job.key);
      return true;
    },
    async completeScheduledJob(key, status) {
      completed.push({ key, status });
    }
  };
  const service = {
    async getReportConfig() {
      return {
        admin_report_enabled: true,
        admin_report_timezone: timeZone,
        admin_report_hour: nowInTimezone.getHours(),
        admin_report_minute: nowInTimezone.getMinutes()
      };
    },
    async pushDailyUsageReport() { pushes += 1; }
  };

  const first = scheduleDailyUsageReport({ service, db });
  const second = scheduleDailyUsageReport({ service, db });
  await new Promise((resolve) => setTimeout(resolve, 50));
  first.stop();
  second.stop();

  assert.equal(pushes, 1);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, 'success');
});

test('daily report scheduler retries a failed push inside the grace window', async () => {
  const now = new Date();
  let pushes = 0;
  const completions = [];
  const service = {
    getReportConfig: async () => ({
      admin_report_enabled: true,
      admin_report_timezone: 'UTC',
      admin_report_hour: now.getUTCHours(),
      admin_report_minute: now.getUTCMinutes()
    }),
    async pushDailyUsageReport() {
      pushes += 1;
      if (pushes === 1) throw new Error('temporary push failure');
    }
  };
  const db = {
    claimScheduledJob: async () => true,
    completeScheduledJob: async (_key, status) => { completions.push(status); }
  };

  const scheduler = scheduleDailyUsageReport({ service, db, intervalMs: 20, retryWindowMinutes: 10, logger: { log() {}, error() {} } });
  await new Promise((resolve) => setTimeout(resolve, 80));
  scheduler.stop();

  assert.ok(pushes >= 2);
  assert.deepEqual(completions.slice(0, 2), ['failed', 'success']);
});

test('daily report grace window crosses midnight without changing the job day', async () => {
  const fixedNow = new Date('2026-07-12T00:03:00.000Z');
  let claimedKey = '';
  let pushes = 0;
  const scheduler = scheduleDailyUsageReport({
    service: {
      getReportConfig: async () => ({
        admin_report_enabled: true,
        admin_report_timezone: 'UTC',
        admin_report_hour: 23,
        admin_report_minute: 59
      }),
      pushDailyUsageReport: async () => { pushes += 1; }
    },
    db: {
      claimScheduledJob: async ({ key }) => { claimedKey = key; return true; },
      completeScheduledJob: async () => {}
    },
    nowProvider: () => fixedNow,
    retryWindowMinutes: 10,
    logger: { log() {}, error() {} }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  scheduler.stop();

  assert.equal(pushes, 1);
  assert.match(claimedKey, /2026-07-11-23-59-UTC/);
});


test('daily scheduler preserves the successful usage summary even when message push is disabled', async () => {
  const now = new Date();
  let archives = 0;
  let pushes = 0;
  const scheduler = scheduleDailyUsageReport({
    service: {
      getReportConfig: async () => ({
        admin_report_enabled: false,
        admin_report_timezone: 'UTC',
        admin_report_hour: now.getUTCHours(),
        admin_report_minute: now.getUTCMinutes()
      }),
      archiveDailySuccessfulUsage: async ({ timezone }) => { archives += timezone === 'UTC' ? 1 : 0; },
      pushDailyUsageReport: async () => { pushes += 1; }
    },
    db: {
      claimScheduledJob: async () => true,
      completeScheduledJob: async () => {}
    },
    nowProvider: () => now,
    logger: { log() {}, error() {} }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  scheduler.stop();

  assert.equal(archives, 1);
  assert.equal(pushes, 0);
});

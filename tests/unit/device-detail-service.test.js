const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeviceReadService } = require('../../src/services/domains/devices/device-read-service');

function contextForDetail() {
  const queries = [];
  return {
    queries,
    context: {
      activeReservationStatus: ['pending', 'approved', 'in_use'],
      addReservationSnapshotsToDevices: async (devices) => devices,
      applyReservationVisibility: (row) => row,
      assertText: (value) => String(value || '').trim(),
      DEFAULT_RESERVATION_SLOT_KEYS: [],
      fail: (message, status, code) => ({ ok: false, message, status, code }),
      getById: async () => null,
      getDeviceByCode: async (deviceCode) => ({ id: 'device-id', device_code: deviceCode }),
      getReservationVisibilityConfig: async () => ({}),
      normalizeReservationSlotOptions: () => [],
      normalizeReservationSlotKeys: () => [],
      nowIso: () => '2026-07-27T00:00:00.000Z',
      ok: (data) => ({ ok: true, ...data }),
      query: async (sql) => {
        queries.push(sql);
        if (/\band status\s*=\s*any/i.test(sql)) throw new Error('ambiguous status reference');
        return [];
      },
      queryOne: async () => null,
      requireAdminRole: async () => {},
      RESERVATION_SLOT_PRESETS: []
    }
  };
}

test('device detail qualifies reservation item columns in the occupancy query', async () => {
  const { context, queries } = contextForDetail();
  const service = createDeviceReadService(context);

  const result = await service.getDeviceDetail({ deviceCode: 'DEMO-001' });

  assert.equal(result.ok, true);
  const occupancyQuery = queries.find((sql) => sql.includes("interval '14 days'"));
  assert.ok(occupancyQuery, 'expected the 14-day occupancy query');
  assert.match(occupancyQuery, /and ri\.status = any\(\$2\)/);
  assert.match(occupancyQuery, /and ri\.start_time >= now\(\)/);
  assert.doesNotMatch(occupancyQuery, /\band status\s*=\s*any/i);
});
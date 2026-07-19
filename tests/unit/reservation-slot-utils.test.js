const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeReservationSlotOptions,
  normalizeReservationSlotKeys,
  withReservationSlotOptions,
  assertNoOverlappingSlots,
  buildReservationSlotsFromKeys,
  DEFAULT_RESERVATION_SLOT_KEYS
} = require('../../src/services/core/reservation-slot-utils');

test('normalizeReservationSlotOptions dedupes and falls back to presets', () => {
  const options = normalizeReservationSlotOptions(['morning', 'morning', 'evening']);
  assert.deepEqual(options.map((item) => item.key), ['morning', 'evening']);
  const fallback = normalizeReservationSlotOptions([]);
  assert.ok(fallback.length >= 4);
});

test('withReservationSlotOptions attaches options and keys', () => {
  const device = withReservationSlotOptions({ id: 1, reservation_slot_keys: ['morning', 'afternoon'] });
  assert.deepEqual(device.reservation_slot_keys, ['morning', 'afternoon']);
  assert.equal(device.reservation_slot_options.length, 2);
});

test('normalizeReservationSlotKeys keeps default when empty', () => {
  assert.deepEqual(normalizeReservationSlotKeys(null), DEFAULT_RESERVATION_SLOT_KEYS);
});

test('assertNoOverlappingSlots rejects overlapping ranges', () => {
  const start = new Date('2026-07-18T00:00:00.000Z');
  const mid = new Date('2026-07-18T02:00:00.000Z');
  const end = new Date('2026-07-18T04:00:00.000Z');
  assert.throws(() => assertNoOverlappingSlots([
    { start, end: mid },
    { start: new Date('2026-07-18T01:00:00.000Z'), end }
  ]));
});

test('buildReservationSlotsFromKeys builds non-overlapping morning/afternoon', () => {
  // Use a future date relative to now to pass parseDates past-check
  const future = new Date(Date.now() + 3 * 86400_000);
  const y = future.getFullYear();
  const m = String(future.getMonth() + 1).padStart(2, '0');
  const d = String(future.getDate()).padStart(2, '0');
  const dateText = `${y}-${m}-${d}`;
  const slots = buildReservationSlotsFromKeys({
    reservation_dates: [dateText],
    slot_keys: ['morning', 'afternoon']
  }, []);
  assert.equal(slots.length, 2);
  assert.ok(slots[0].start < slots[0].end);
});

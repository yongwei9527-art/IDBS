const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rentalServiceSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/create-rental-service.js'), 'utf8');
const systemConfigurationSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/features/system/system-configuration-page.tsx'), 'utf8');

test('public reservation and device responses never expose peer phone numbers', () => {
  const visibilityStart = rentalServiceSource.indexOf('async function getReservationVisibilityConfig');
  assert.notEqual(visibilityStart, -1);
  const visibilitySource = rentalServiceSource.slice(visibilityStart, visibilityStart + 320);
  assert.ok(visibilitySource.includes('showPhone: false'));
  assert.ok(rentalServiceSource.includes('public_show_reserver_phone: false'));
});

test('the obsolete public-phone switch is not offered in system configuration', () => {
  assert.equal(systemConfigurationSource.includes('公开预约人手机'), false);
  assert.ok(systemConfigurationSource.includes('public_show_reserver_phone: false'));
});

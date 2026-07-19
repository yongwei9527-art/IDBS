const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_PERMISSIONS, PERMISSION_KEYS } = require('../../src/modules/lab-modules');

test('role permission matrix keeps duty/approval without user.manage', () => {
  const duty = ROLE_PERMISSIONS.duty_admin || ROLE_PERMISSIONS.equipment_duty || [];
  // Find likely duty / reservation roles by key
  const keys = Object.keys(ROLE_PERMISSIONS);
  assert.ok(keys.length > 0, 'ROLE_PERMISSIONS should not be empty');
  for (const key of keys) {
    const perms = ROLE_PERMISSIONS[key] || [];
    if (/duty|equipment_admin|reservation_admin|approval/i.test(key) && key !== 'super_admin') {
      assert.equal(perms.includes('user.manage'), false, `${key} must not include user.manage`);
    }
  }
  assert.ok(PERMISSION_KEYS instanceof Set ? PERMISSION_KEYS.has('user.manage') : PERMISSION_KEYS.includes('user.manage'));
});

test('super_admin equivalent role retains broad access when defined', () => {
  if (ROLE_PERMISSIONS.super_admin) {
    assert.ok(ROLE_PERMISSIONS.super_admin.includes('*') || ROLE_PERMISSIONS.super_admin.includes('user.manage'));
  }
});

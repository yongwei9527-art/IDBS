const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserService } = require('../../src/services/domains/users/user-service');
const { createDeviceAdminService } = require('../../src/services/domains/devices/device-admin-service');

function deniedAdminHarness(createService) {
  const calls = [];
  const service = createService({
    async requireAdminRole(token, roles, permissions) {
      calls.push({ token, roles, permissions });
      const error = new Error('forbidden');
      error.status = 403;
      error.code = 1003;
      throw error;
    }
  });
  return { service, calls };
}

async function expectOrdinaryAdminDenied(operation) {
  await assert.rejects(
    operation,
    (error) => error?.status === 403 && error?.code === 1003
  );
}

test('user single and batch deletion require only the super_admin role', async () => {
  const { service, calls } = deniedAdminHarness(createUserService);
  const ordinaryAdmin = { role: 'admin', user_id: 'admin-1' };

  await expectOrdinaryAdminDenied(() => service.adminDeleteUser(
    { user_id: 'user-1' },
    ordinaryAdmin
  ));
  await expectOrdinaryAdminDenied(() => service.adminDeleteUsers(
    { user_ids: ['user-1', 'user-2'] },
    ordinaryAdmin
  ));

  assert.deepEqual(calls.map((call) => call.roles), [
    ['super_admin'],
    ['super_admin']
  ]);
  assert.deepEqual(calls.map((call) => call.permissions), [[], []]);
});

test('device single and batch deletion require only the super_admin role', async () => {
  const { service, calls } = deniedAdminHarness(createDeviceAdminService);
  const ordinaryAdmin = { role: 'admin', user_id: 'admin-1' };

  await expectOrdinaryAdminDenied(() => service.adminDeleteDevice(
    { device_id: 'device-1' },
    ordinaryAdmin
  ));
  await expectOrdinaryAdminDenied(() => service.adminDeleteDevices(
    { device_ids: ['device-1', 'device-2'] },
    ordinaryAdmin
  ));

  assert.deepEqual(calls.map((call) => call.roles), [
    ['super_admin'],
    ['super_admin']
  ]);
  assert.deepEqual(calls.map((call) => call.permissions), [[], []]);
});
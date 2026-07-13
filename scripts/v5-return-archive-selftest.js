const fs = require('fs');
const path = require('path');
const { createBorrowReturnService } = require('../src/services/domains/reservations/borrow-return-service');
const { createDeviceAdminService } = require('../src/services/domains/devices/device-admin-service');
const { ok, fail, safeFilename } = require('../src/services/core/service-utils');

async function main() {
  const uploadDir = path.join(process.cwd(), 'uploads', '.selftest-return-archive');
  const sourceDir = path.join(uploadDir, 'tmp');
  const returnsDir = path.join(uploadDir, 'returns');
  await fs.promises.rm(uploadDir, { recursive: true, force: true });
  await fs.promises.mkdir(sourceDir, { recursive: true });
  const sourceFile = path.join(sourceDir, 'demo-return.png');
  await fs.promises.writeFile(sourceFile, Buffer.from('89504e470d0a1a0a', 'hex'));

  const user = { id: 'u-photo', name: '婕旂ず鐢ㄦ埛', phone: '13800009999' };
  const device = { id: 'd-photo', name: '楂樼簿搴︽樉寰暅', device_code: 'R200' };
  const record = {
    id: 'br-photo',
    reservation_id: 'r-photo',
    reservation_item_id: 'ri-photo',
    device_id: device.id,
    user_id: user.id,
    borrow_time: '2026-07-06T01:00:00.000Z',
    expected_return_time: '2026-07-06T03:00:00.000Z',
    status: 'in_use'
  };
  const queries = [];

  const service = createBorrowReturnService({
    appendUsageLog: async () => {},
    assertText: (value, name) => {
      if (!value) throw new Error(`${name} required`);
      return String(value);
    },
    durationMinutes: () => 60,
    fail,
    getById: async (table, id) => {
      if (table === 'borrow_records' && id === record.id) return record;
      if (table === 'devices' && id === device.id) return device;
      return null;
    },
    getSecurityConfig: async () => ({ require_return_photo: false }),
    log: async () => {},
    notifyReservationUsersForDevice: async () => {},
    nowIso: () => '2026-07-06T02:00:00.000Z',
    ok,
    requireUser: async () => user,
    safeFilename,
    uploadDir,
    uuid: () => 'return-test-uuid-001',
    withTransaction: async (fn) => fn({ query: async (sql, params = []) => queries.push({ sql, params }) })
  });

  const result = await service.submitReturn({
    record_id: record.id,
    return_condition: '灞忓箷寮傚父',
    return_note: '褰掕繕褰掓。鑷祴',
    return_photos: ['/uploads/tmp/demo-return.png']
  }, 'token');

  if (!result.ok) throw new Error(`submitReturn failed: ${result.message}`);
  const archivedFiles = await fs.promises.readdir(returnsDir, { recursive: true });
  const folder = archivedFiles.find((item) => String(item) === 'return-20260706-1000-return-test-uuid-001');
  const image = archivedFiles.find((item) => /\.png$/i.test(String(item)));
  if (!folder || !image || archivedFiles.some((item) => /13800009999|演示用户/.test(String(item)))) {
    throw new Error(`return photo archive should use a non-identifying folder name: ${JSON.stringify(archivedFiles)}`);
  }
  const updateBorrow = queries.find((entry) => String(entry.sql).startsWith('update borrow_records'));
  const archivedJson = updateBorrow?.params?.[4];
  if (!String(archivedJson || '').includes('/uploads/returns/')) {
    throw new Error('return photo archive URL was not written into borrow record update');
  }

  const unsafeResult = await service.submitReturn({
    record_id: record.id,
    return_condition: '姝ｅ父',
    return_note: '涓嶅畨鍏ㄥ湴鍧€鑷祴',
    return_photos: ['/admin/secret.png']
  }, 'token');
  if (unsafeResult.ok !== false || unsafeResult.status !== 400 || !String(unsafeResult.message || '').trim()) {
    throw new Error(`unsafe return photo URL should be rejected with Chinese message: ${JSON.stringify(unsafeResult)}`);
  }

  const archiveBorrowRow = {
    id: 'br-archive-visible',
    device_id: device.id,
    user_id: user.id,
    return_photos: ['/uploads/raw/demo-return.png'],
    return_archive_photos: ['/uploads/returns/demo-folder/??????.png'],
    return_archive_folder: '??????_20260706-1000_????_13800009999_??1',
    return_note: '??????',
    return_time: '2026-07-06T02:00:00.000Z'
  };
  const deviceAdmin = createDeviceAdminService({
    addNamesToBorrowRows: async (rows) => rows,
    assertText: (value, name) => {
      if (!value) throw new Error(`${name} required`);
      return String(value);
    },
    fail,
    effectiveRolePermissions: (role) => Array.isArray(role.permissions) ? role.permissions : [],
    getById: async (table, id) => (table === 'devices' && id === device.id ? device : null),
    isSafeUrl: (value) => String(value || '').startsWith('/uploads/'),
    log: async () => {},
    normalizeReservationSlotOptions: (value) => value || [],
    normalizeReservationSlotKeys: (value) => value || [],
    notifyReservationUsersForDevice: async () => {},
    nowIso: () => '2026-07-06T02:00:00.000Z',
    ok,
    query: async (sql) => {
      const statement = String(sql);
      if (statement.includes('from borrow_records')) return [archiveBorrowRow];
      if (statement.includes('from reservation_items')) return [];
      if (statement.includes('from device_fault_reports')) return [];
      return [];
    },
    requireAdminRole: async (token) => ({
      admin: { id: 'admin-selftest', role: 'admin' },
      role: token === 'archive-token' ? { permissions: ['return.view'] } : { permissions: ['device.view'] }
    }),
    uuid: () => 'uuid-selftest',
    withReservationSlotOptions: (row) => row,
    withTransaction: async (fn) => fn({ query: async () => {} }),
    markDeviceFaultReportsResolved: async () => {}
  });

  const restrictedDetail = await deviceAdmin.adminGetDeviceDetail({ id: device.id }, 'restricted-token');
  if (!restrictedDetail.ok || restrictedDetail.can_view_return_archive !== false) {
    throw new Error(`restricted admin should not view return archive: ${JSON.stringify(restrictedDetail)}`);
  }
  const restrictedBorrow = restrictedDetail.borrows?.[0] || {};
  if (restrictedBorrow.return_archive_folder || restrictedBorrow.return_archive_photos?.length || restrictedBorrow.return_photos?.length || restrictedBorrow.return_archive_restricted !== true) {
    throw new Error(`return archive fields should be masked for restricted admin: ${JSON.stringify(restrictedBorrow)}`);
  }

  const allowedDetail = await deviceAdmin.adminGetDeviceDetail({ id: device.id }, 'archive-token');
  const allowedBorrow = allowedDetail.borrows?.[0] || {};
  if (!allowedDetail.ok || allowedDetail.can_view_return_archive !== true || !allowedBorrow.return_archive_folder || !allowedBorrow.return_archive_photos?.length) {
    throw new Error(`return archive fields should be visible for authorized admin: ${JSON.stringify(allowedDetail)}`);
  }

  await fs.promises.rm(uploadDir, { recursive: true, force: true });
  console.log('v5 return archive selftest ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});



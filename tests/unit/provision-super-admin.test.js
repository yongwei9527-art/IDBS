const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, provisionSuperAdmin, validateCredentials } = require('../../scripts/provision-super-admin');

test('VPS highest administrator credentials require a valid phone and strong password', () => {
  assert.deepEqual(validateCredentials({
    phone: '13900000000',
    password: 'IDBS!12345678',
    name: '系统管理员'
  }), {
    phone: '13900000000',
    password: 'IDBS!12345678',
    name: '系统管理员'
  });
  assert.throws(() => validateCredentials({ phone: 'bad', password: 'IDBS!12345678' }), /SUPER_ADMIN_PHONE/);
  assert.throws(() => validateCredentials({ phone: '13900000000', password: '123456' }), /12-128/);
  assert.throws(() => validateCredentials({ phone: '13900000000', password: 'x'.repeat(129) }), /12-128/);
});

test('VPS highest administrator password uses the application scrypt format', () => {
  const hash = hashPassword('IDBS!12345678', 'fixed-test-salt');
  assert.match(hash, /^[a-f0-9]{128}$/);
});

test('provisioned highest administrator must change the temporary password', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql).trim();
      calls.push({ text, params });
      if (text.startsWith('select u.id')) return { rows: [] };
      if (text.startsWith('insert into users')) {
        return { rows: [{ id: 'admin-id', phone: params[1], name: params[0] }] };
      }
      return { rows: [] };
    }
  };

  const result = await provisionSuperAdmin(client, {
    phone: '13900000000',
    password: 'IDBS!12345678',
    name: '系统管理员'
  });

  const userUpsert = calls.find((call) => call.text.startsWith('insert into users'));
  assert.match(userUpsert.text, /values \(\$1, \$2, \$3, \$4, \$5, \$6, true,/);
  assert.match(userUpsert.text, /password_reset_required = true/);
  assert.equal(result.password_reset_required, true);
  assert.equal(calls.at(-1).text, 'commit');
});
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  setLocalDatabaseRolePassword
} = require('../../scripts/set-local-db-role-password');

test('local database role password helper parameterizes the secret before executing DDL', async () => {
  const calls = [];
  class FakeClient {
    async connect() { calls.push(['connect']); }
    async query(sql, params) {
      calls.push(['query', sql, params]);
      if (params) {
        return {
          rows: [{
            sql: "ALTER ROLE laboratory_management_system_user WITH LOGIN PASSWORD 'quoted-secret'"
          }]
        };
      }
      return { rows: [] };
    }
    async end() { calls.push(['end']); }
  }

  await setLocalDatabaseRolePassword({
    operation: 'ALTER',
    password: "unsafe'password\\value",
    ClientClass: FakeClient
  });

  assert.deepEqual(calls[1][2], ["unsafe'password\\value"]);
  assert.match(calls[1][1], /PASSWORD %L/);
  assert.equal(calls[2][1], "ALTER ROLE laboratory_management_system_user WITH LOGIN PASSWORD 'quoted-secret'");
  assert.deepEqual(calls.at(-1), ['end']);
});

test('local database role password helper rejects invalid operations and line breaks', async () => {
  await assert.rejects(
    setLocalDatabaseRolePassword({ operation: 'DROP', password: 'valid-password' }),
    /Invalid local database role operation/
  );
  await assert.rejects(
    setLocalDatabaseRolePassword({ operation: 'CREATE', password: 'bad\npassword' }),
    /empty or invalid/
  );
});

test('deployment changes the local role without executing release code as postgres', () => {
  const deploy = fs.readFileSync(path.resolve(__dirname, '../../scripts/deploy-ubuntu.sh'), 'utf8');
  assert.match(deploy, /--set=password_file="\$LOCAL_DB_PASSWORD_FILE"/);
  assert.match(deploy, /pg_read_file\(:'password_file'\)/);
  assert.match(deploy, /format\('[^']*PASSWORD %L'/);
  assert.doesNotMatch(deploy, /sudo -u postgres node/);
  assert.doesNotMatch(deploy, /psql[^\n]*(?:\$password|DATABASE_URL)/);
});

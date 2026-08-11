const test = require('node:test');
const assert = require('node:assert/strict');

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

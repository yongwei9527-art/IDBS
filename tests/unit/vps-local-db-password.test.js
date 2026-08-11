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

test('deployment contains a syntactically valid password-on-stdin fallback', () => {
  const deploy = fs.readFileSync(path.resolve(__dirname, '../../scripts/deploy-ubuntu.sh'), 'utf8');
  const fallback = deploy.match(/NODE_PATH="\$CANDIDATE_RELEASE\/node_modules" node -e '\n([\s\S]*?)\n' "\$operation"/);
  assert.ok(fallback, 'inline fallback was not found');
  assert.doesNotMatch(fallback[1], /'/, 'a single quote would terminate the shell-quoted Node program');
  assert.doesNotThrow(() => new Function(fallback[1]));
  assert.match(fallback[1], /fs\.readFileSync\(0, "utf8"\)/);
  assert.doesNotMatch(fallback[1], /process\.argv\[[^\]]+\].*password/i);
});

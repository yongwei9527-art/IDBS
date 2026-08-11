const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runner = fs.readFileSync(path.resolve(__dirname, '../../scripts/run-isolated-e2e.js'), 'utf8');

test('isolated E2E preparation resets, migrates and seeds only the explicit E2E database', () => {
  assert.match(runner, /E2E_DATABASE_URL is required; DATABASE_URL is intentionally ignored/);
  assert.match(runner, /\(\^\|\[_-\]\)e2e\(\[_-\]\|\$\)/);
  assert.match(runner, /RESET_LABORATORY_MANAGEMENT_SYSTEM_SCHEMA: '1'/);

  const resetIndex = runner.indexOf("path.join('scripts', 'reset-schema.js')");
  const migrateIndex = runner.indexOf("path.join('scripts', 'migrate-db.js')");
  const prepareIndex = runner.indexOf("path.join('scripts', 'prepare-demo-db.js')");
  const seedIndex = runner.indexOf("path.join('scripts', 'seed-demo-data.js')");
  assert.ok(resetIndex > 0, 'reset-schema.js must be called');
  assert.ok(migrateIndex > resetIndex, 'migrations must follow the reset baseline');
  assert.ok(prepareIndex > migrateIndex, 'demo compatibility preparation must follow migrations');
  assert.ok(seedIndex > prepareIndex, 'deterministic seed data must be applied last');
});
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  discoverMigrationFiles,
  isForwardMigrationFile,
  migrationChecksum,
  stripOuterTransactionWrapper
} = require('../../scripts/migrate-db');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('product manifests, 5.0 schema baseline, migration and CI gate stay aligned', () => {
  const rootPackage = JSON.parse(read('package.json'));
  const webPackage = JSON.parse(read('web/package.json'));
  const schema = read('sql/schema.sql');
  const migration = read('sql/migrations/2026-07-11_v5_release_foundation.sql');
  const maintenanceMigration = read('sql/migrations/2026-07-12_device_maintenance.sql');
  const lifecycleMigration = read('sql/migrations/2026-07-12_maintenance_lifecycle_index.sql');
  const exportMigration = read('sql/migrations/2026-07-12_export_job_reliability.sql');
  const upgrader = read('scripts/upgrade-schema.js');
  const workflow = read('.github/workflows/check.yml');

  assert.equal(rootPackage.version, webPackage.version);
  assert.match(rootPackage.version, /^\d+\.\d+\.\d+$/);

  for (const objectName of ['refresh_token_sessions', 'scheduled_job_runs', 'rate_limit_buckets']) {
    assert.match(schema, new RegExp(`create table if not exists ${objectName}`, 'i'));
    assert.match(migration, new RegExp(`create table if not exists ${objectName}`, 'i'));
    assert.match(upgrader, new RegExp(objectName));
  }

  for (const indexName of [
    'idx_refresh_token_sessions_expiry',
    'idx_scheduled_job_runs_name_time',
    'idx_rate_limit_buckets_expiry',
    'idx_reservation_items_pending_time',
    'idx_borrow_records_active_due',
    'idx_users_pending_active'
  ]) {
    assert.match(schema, new RegExp(indexName, 'i'));
    assert.match(migration, new RegExp(indexName, 'i'));
    assert.match(upgrader, new RegExp(indexName, 'i'));
    assert.match(read('scripts/doctor.js'), new RegExp(indexName, 'i'));
  }

  for (const objectName of ['device_maintenance_plans', 'device_maintenance_windows', 'device_maintenance_work_orders']) {
    assert.match(schema, new RegExp(`create table if not exists ${objectName}`, 'i'));
    assert.match(maintenanceMigration, new RegExp(`create table if not exists ${objectName}`, 'i'));
    assert.match(upgrader, new RegExp(objectName));
  }
  assert.match(schema, /idx_maintenance_windows_lifecycle/i);
  assert.match(lifecycleMigration, /idx_maintenance_windows_lifecycle/i);
  assert.match(upgrader, /idx_maintenance_windows_lifecycle/i);
  assert.match(read('scripts\/doctor.js'), /idx_maintenance_windows_lifecycle/i);
  assert.match(read('src\/tasks\/maintenance-window-scheduler.js'), /maintenance-window-lifecycle/);


  for (const indexName of ['idx_export_jobs_worker_queue', 'idx_export_jobs_expired_files']) {
    assert.match(schema, new RegExp(indexName, 'i'));
    assert.match(exportMigration, new RegExp(indexName, 'i'));
    assert.match(upgrader, new RegExp(indexName, 'i'));
    assert.match(read('scripts/doctor.js'), new RegExp(indexName, 'i'));
  }
  for (const columnName of ['attempt_count', 'max_attempts', 'available_at', 'worker_id', 'lease_token', 'lease_expires_at']) {
    assert.match(schema, new RegExp(columnName, 'i'));
    assert.match(exportMigration, new RegExp(columnName, 'i'));
    assert.match(upgrader, new RegExp(columnName, 'i'));
  }
  assert.doesNotMatch(schema, /admin_default_password_seed/i);
  assert.match(schema, /schema_v5_applied_at/i);
  assert.match(migration, /delete from system_configs where config_key = 'admin_default_password_seed'/i);
  assert.match(migration, /schema_v5_applied_at/i);
  assert.match(upgrader, /remove deprecated admin password seed/i);
  assert.match(upgrader, /schema_v5_applied_at/i);
  assert.match(read('scripts/doctor.js'), /v5 config schema_v5_applied_at/);
  assert.match(workflow, /image: postgres:16/);
  assert.match(workflow, /RESET_LABORATORY_MANAGEMENT_SYSTEM_SCHEMA: 1/);
  assert.match(workflow, /npm run v5:quality/);
  assert.match(workflow, /npm run db:migrate/);

  for (const uiPath of [
    'public/v5/index.html',
    'web/vite.config.ts',
    'web/index.html',
    'web/src/features/system/system-configuration-page.tsx'
  ]) {
    const source = read(uiPath);
    assert.match(source, /(?:实验室管理系统\s*)?5\.0/);
    assert.doesNotMatch(source, /实验室管理系统\s*[234](?:\.0)?|[34]\.0\s*閺呴缚鍏樻潻鎰儉/);
  }
  const dashboardSource = read('web/src/features/dashboard/dashboard-placeholder.tsx');
  assert.doesNotMatch(dashboardSource, /实验室管理系统\s*[234](?:\.0)?|[34]\.0\s*閺呴缚鍏樻潻鎰儉/);
});

test('automatic migration discovery never executes rollback scripts', () => {
  assert.equal(isForwardMigrationFile('2026-07-11_v5_release_foundation.sql'), true);
  assert.equal(isForwardMigrationFile('2026-07-04_v3_foundation_rollback.sql'), false);
  const files = discoverMigrationFiles(path.join(root, 'sql', 'migrations'));
  assert.ok(files.includes('2026-07-11_v5_release_foundation.sql'));
  assert.ok(files.every((file) => !/rollback/i.test(file)));
  const deploy = read('scripts/deploy-ubuntu.sh');
  assert.match(deploy, /apply_database_schema\(\)/);
  assert.match(deploy, /MIGRATION_DATABASE_URL/);
  assert.match(deploy, /node "\$CANDIDATE_RELEASE\/scripts\/migrate-db\.js"/);
  assert.match(deploy, /stop_application_for_migration/);
  assert.doesNotMatch(deploy, /for migration in .*sql\/migrations/);
  assert.match(read('scripts/init-db.ps1'), /Name -notmatch '[^']*rollback/);
  assert.match(read('scripts/setup-local-db.ps1'), /Name -notmatch '[^']*rollback/);
  assert.match(read('scripts/init-db.ps1'), /--single-transaction -f \$_\.FullName/);
  const localSetupScript = read('scripts/setup-local-db.ps1');
  assert.match(localSetupScript, /"--single-transaction"/);
  assert.match(localSetupScript, /"-f", \$_.FullName/);
  assert.equal(migrationChecksum('select 1;\r\n'), migrationChecksum('select 1;\n'));
  assert.equal(stripOuterTransactionWrapper('BEGIN;\nselect 1;\nCOMMIT;\n').trim(), 'select 1;');
});




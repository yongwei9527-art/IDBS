const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const {
  SAFE_SEARCH_PATH,
  getMigrationConnectionString,
  grantRuntimeDatabasePrivileges,
  migrateDatabase,
  migrationChecksum,
  normalizeMigrationSource,
  runtimeRoleFromConnectionString,
  stripOuterTransactionWrapper
} = require('../../scripts/migrate-db');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..', '..');
const migrator = path.join(root, 'scripts', 'migrate-db.js');
const correctionVersion = '2026-08-08_schema_upgrade_safety';

test('migration source checksums, transaction wrappers and connection selection are deterministic', () => {
  assert.equal(normalizeMigrationSource('\uFEFFselect 1;\r\n'), 'select 1;\n');
  assert.equal(migrationChecksum('select 1;\r\n'), migrationChecksum('select 1;\n'));
  assert.notEqual(migrationChecksum('select 1;\n'), migrationChecksum('select 2;\n'));
  assert.equal(stripOuterTransactionWrapper('-- migration\nBEGIN;\nselect 1;\nCOMMIT;\n'), '-- migration\nselect 1;\n');
  assert.equal(stripOuterTransactionWrapper('do $$ begin perform 1; end $$;'), 'do $$ begin perform 1; end $$;');
  assert.equal(getMigrationConnectionString({ DATABASE_URL: 'postgres://app' }), 'postgres://app');
  assert.equal(getMigrationConnectionString({ DATABASE_URL: 'postgres://app', MIGRATION_DATABASE_URL: 'postgres://owner' }), 'postgres://owner');
});

test('deployment and migrators statically enforce the safe upgrade path', () => {
  const deploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-ubuntu.sh'), 'utf8');
  const migrate = fs.readFileSync(migrator, 'utf8');
  const upgrade = fs.readFileSync(path.join(root, 'scripts', 'upgrade-schema.js'), 'utf8');
  const repair = fs.readFileSync(path.join(root, 'sql', 'migrations', `${correctionVersion}.sql`), 'utf8');

  assert.match(deploy, /ensure_local_database\(\)/);
  assert.match(deploy, /apply_database_schema\(\)/);
  assert.match(deploy, /MIGRATION_DATABASE_URL/);
  assert.match(deploy, /external PostgreSQL database/);
  assert.match(deploy, /stop_application_for_migration/);
  assert.doesNotMatch(deploy, /if ! parse_local_database_password/);
  assert.ok(deploy.indexOf('stop_application_for_migration') < deploy.lastIndexOf('apply_database_schema'));
  assert.doesNotMatch(deploy, /for migration in .*sql\/migrations/);

  assert.match(migrate, /pg_advisory_lock/);
  assert.match(migrate, /pg_advisory_xact_lock/);
  assert.match(migrate, /checksum mismatch/i);
  assert.match(migrate, /for update/);
  assert.match(migrate, /validateCriticalSchema/);
  assert.match(upgrade, /migrateDatabase/);
  assert.doesNotMatch(upgrade, /completed with warnings/i);

  assert.match(repair, /pg_attribute/);
  assert.match(repair, /format_type/);
  assert.match(repair, /a\.attnum = ANY\(c\.conkey\)/i);
  assert.match(repair, /DROP INDEX IF EXISTS public\.idx_password_reset_requests_pending_user/i);
  assert.match(repair, /CREATE UNIQUE INDEX idx_password_reset_requests_pending_user/i);
  assert.match(repair, /DROP INDEX IF EXISTS public\.idx_legacy_import_runs_active_hash/i);
  assert.match(repair, /CREATE UNIQUE INDEX idx_legacy_import_runs_active_hash/i);
  assert.match(repair, /'reservation_item'::text AS source_type/i);
  assert.match(repair, /WHERE d\.deleted_at IS NULL/i);
});


function forwardMigrationSources() {
  const directory = path.join(root, 'sql', 'migrations');
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith('.sql') && !/(?:^|[._-])rollback(?:[._-]|$)/i.test(file))
    .sort()
    .map((file) => ({ file, source: fs.readFileSync(path.join(directory, file), 'utf8') }));
}

function extractIndexNames(source) {
  return Array.from(String(source).matchAll(
    /create\s+(?:unique\s+)?index\s+if\s+not\s+exists\s+(?:public\.)?"?([a-z_][\w$]*)"?/gi
  ), (match) => match[1].toLowerCase());
}

function extractAddedColumns(source) {
  const columns = [];
  const statementPattern = /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][\w$]*)"?\s+([\s\S]*?);/gi;
  for (const statement of String(source).matchAll(statementPattern)) {
    const table = statement[1].toLowerCase();
    for (const addition of statement[2].matchAll(/add\s+column\s+if\s+not\s+exists\s+"?([a-z_][\w$]*)"?/gi)) {
      columns.push([table, addition[1].toLowerCase()]);
    }
  }
  return columns;
}

function baselineColumns(source) {
  const columns = new Set(extractAddedColumns(source).map(([table, column]) => table + '.' + column));
  let currentTable = '';
  for (const line of String(source).split(/\r?\n/)) {
    const create = line.match(/^\s*create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?"?([a-z_][\w$]*)"?\s*\(/i);
    if (create) {
      currentTable = create[1].toLowerCase();
      continue;
    }
    if (currentTable && /^\s*\);/.test(line)) {
      currentTable = '';
      continue;
    }
    if (!currentTable) continue;
    const column = line.match(/^\s*"?([a-z_][\w$]*)"?\s+/i);
    if (column && !['constraint', 'primary', 'unique', 'foreign', 'check', 'exclude'].includes(column[1].toLowerCase())) {
      columns.add(currentTable + '.' + column[1].toLowerCase());
    }
  }
  return columns;
}

function createTableBlock(source, table) {
  const lines = String(source).split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(
    '^\\s*create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?"?' + table + '"?\\s*\\(',
    'i'
  ).test(line));
  if (start < 0) return '';
  const block = [];
  for (let index = start; index < lines.length; index += 1) {
    block.push(lines[index]);
    if (index > start && /^\s*\);/.test(lines[index])) break;
  }
  return block.join('\n');
}

test('empty-database baseline contains every idempotent migrated column and index', () => {
  const schema = fs.readFileSync(path.join(root, 'sql', 'schema.sql'), 'utf8');
  const migrations = forwardMigrationSources();
  const schemaIndexes = new Set(extractIndexNames(schema));
  const schemaColumns = baselineColumns(schema);
  const missingIndexes = [];
  const missingColumns = [];

  for (const migration of migrations) {
    for (const index of extractIndexNames(migration.source)) {
      if (!schemaIndexes.has(index)) missingIndexes.push([migration.file, index]);
    }
    for (const [table, column] of extractAddedColumns(migration.source)) {
      if (!schemaColumns.has(table + '.' + column)) missingColumns.push([migration.file, table, column]);
    }
  }

  assert.deepEqual(missingIndexes, []);
  assert.deepEqual(missingColumns, []);
  assert.match(createTableBlock(schema, 'reservation_items'), /\bno_show_reason_category\s+TEXT\b/i);
  assert.doesNotMatch(createTableBlock(schema, 'user_requests'), /\bno_show_reason_category\b/i);
});

test('doctor and migrator validate the corrected baseline under a fixed search_path', () => {
  const doctor = fs.readFileSync(path.join(root, 'scripts', 'doctor.js'), 'utf8');
  const migrate = fs.readFileSync(migrator, 'utf8');
  const requiredIndexes = [
    'idx_reservation_reminder_window',
    'idx_borrow_reminder_window',
    'idx_user_notifications_level_user_time',
    'idx_chat_message_reads_user_conv',
    'idx_chat_conversations_expires_at'
  ];

  for (const index of requiredIndexes) {
    assert.equal((doctor.match(new RegExp("'" + index + "'", 'g')) || []).length, 1);
  }
  assert.equal((doctor.match(/\['reservation_items', 'no_show_reason_category'\]/g) || []).length, 1);
  assert.equal(SAFE_SEARCH_PATH, 'public, pg_temp');
  assert.match(migrate, /set search_path = \$\{SAFE_SEARCH_PATH\}/);
  assert.match(migrate, /set local search_path = \$\{SAFE_SEARCH_PATH\}/);
  assert.match(migrate, /public\.schema_migrations/);
});

test('external migration credentials grant current and future runtime object privileges', async () => {
  assert.equal(runtimeRoleFromConnectionString('postgresql://runtime%2Dapp:secret@db.example.com/lab'), 'runtime-app');
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ sql: String(sql), params });
      if (/select current_user as role/i.test(sql)) return { rowCount: 1, rows: [{ role: 'migration_owner' }] };
      if (/from pg_catalog\.pg_roles/i.test(sql)) return { rowCount: 1, rows: [{ '?column?': 1 }] };
      return { rowCount: 0, rows: [] };
    }
  };

  await grantRuntimeDatabasePrivileges(client, 'postgresql://runtime%2Dapp:secret@db.example.com/lab');
  const sql = statements.map((entry) => entry.sql.toLowerCase()).join('\n');
  assert.match(sql, /grant usage on schema public to "runtime-app"/);
  assert.match(sql, /grant select, insert, update, delete on all tables in schema public to "runtime-app"/);
  assert.match(sql, /grant usage, select, update on all sequences in schema public to "runtime-app"/);
  assert.match(sql, /grant execute on all functions in schema public to "runtime-app"/);
  assert.match(sql, /alter default privileges for role "migration_owner" in schema public grant select, insert, update, delete on tables/);
  assert.match(sql, /alter default privileges for role "migration_owner" in schema public grant usage, select, update on sequences/);
  assert.match(sql, /alter default privileges for role "migration_owner" in schema public grant execute on functions/);
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger on table public\.schema_migrations/);
});

test('VPS migration environment forwards PGSSL_CA and enables runtime grants for separate credentials', () => {
  const deploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-ubuntu.sh'), 'utf8');
  assert.match(deploy, /^PGSSL_CA=$/m);
  assert.match(deploy, /pgssl_ca="\$\(get_env_value PGSSL_CA \|\| true\)"/);
  assert.match(deploy, /PGSSL_CA="\$pgssl_ca" \\/);
  assert.match(deploy, /if \[ -n "\$migration_database_url" \]; then[\s\S]*grant_runtime=true/);
  assert.match(deploy, /GRANT_RUNTIME_DATABASE_PRIVILEGES="\$grant_runtime" \\/);
});

const adminUrlText = String(process.env.MIGRATION_TEST_ADMIN_URL || '').trim();

test('PostgreSQL 16 migration fault-injection matrix', { skip: !adminUrlText, timeout: 300_000 }, async (t) => {
  const adminUrl = new URL(adminUrlText);
  if (!['127.0.0.1', 'localhost'].includes(adminUrl.hostname)) {
    throw new Error('MIGRATION_TEST_ADMIN_URL must point to an isolated localhost PostgreSQL instance.');
  }
  if (adminUrl.pathname.replace(/^\//, '') !== 'postgres') {
    throw new Error('MIGRATION_TEST_ADMIN_URL must use the postgres maintenance database.');
  }

  const prefix = `lab_migration_test_${process.pid}_${Date.now()}`.toLowerCase();
  const databases = [];
  const admin = new Pool({ connectionString: adminUrlText, ssl: false });

  const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const databaseUrl = (name) => {
    const url = new URL(adminUrlText);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const createDatabase = async (suffix, template) => {
    const name = `${prefix}_${suffix}`;
    await admin.query(`create database ${quoteIdent(name)}${template ? ` template ${quoteIdent(template)}` : ''}`);
    databases.push(name);
    return name;
  };
  const withDatabase = async (name, callback) => {
    const pool = new Pool({ connectionString: databaseUrl(name), ssl: false });
    try {
      return await callback(pool);
    } finally {
      await pool.end();
    }
  };
  const runMigrator = async (name, expectFailure = false, envOverrides = {}) => {
    try {
      const result = await execFileAsync(process.execPath, [migrator], {
        cwd: root,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl(name),
          MIGRATION_DATABASE_URL: '',
          PGSSL: 'false',
          ...envOverrides
        },
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024
      });
      if (expectFailure) assert.fail(`Migration unexpectedly succeeded:\n${result.stdout}`);
      return result;
    } catch (error) {
      if (!expectFailure) throw error;
      return error;
    }
  };

  try {
    const base = await createDatabase('base');
    await t.test('new database baseline is atomic, checksummed and repeatable', async () => {
      const first = await runMigrator(base);
      assert.match(first.stdout, /BASELINE/);
      const second = await runMigrator(base);
      assert.match(second.stdout, /SKIP 2026-08-08_schema_upgrade_safety\.sql/);
      await withDatabase(base, async (pool) => {
        const invalid = await pool.query("select count(*)::int as count from schema_migrations where checksum !~ '^[0-9a-f]{64}$' or checksum is null");
        assert.equal(invalid.rows[0].count, 0);
      });
    });

    await t.test('a failing empty-database baseline rolls back every object', async () => {
      const database = await createDatabase('baseline_rollback');
      const invalidSchema = path.join(os.tmpdir(), `lab-invalid-schema-${process.pid}-${Date.now()}.sql`);
      fs.writeFileSync(invalidSchema, 'create table must_rollback (id integer);\nselect missing_function();\n', 'utf8');
      try {
        await assert.rejects(
          migrateDatabase({ connectionString: databaseUrl(database), schemaPath: invalidSchema, files: [] }),
          /missing_function/
        );
      } finally {
        fs.unlinkSync(invalidSchema);
      }
      await withDatabase(database, async (pool) => {
        const relation = await pool.query("select to_regclass('public.must_rollback') as relation");
        assert.equal(relation.rows[0].relation, null);
      });
    });

    await t.test('MIGRATION_DATABASE_URL initializes an external database even when the app URL cannot migrate', async () => {
      const database = await createDatabase('external_owner');
      const result = await runMigrator(database, false, {
        DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unreachable',
        MIGRATION_DATABASE_URL: databaseUrl(database)
      });
      assert.match(result.stdout, /BASELINE/);
      await withDatabase(database, async (pool) => {
        const table = await pool.query("select to_regclass('public.password_reset_requests') as relation");
        assert.equal(table.rows[0].relation, 'password_reset_requests');
      });
    });

    await t.test('a preloaded current schema stays idempotent and forward migrations run twice', async () => {
      const database = await createDatabase('preloaded_schema');
      const schema = fs.readFileSync(path.join(root, 'sql', 'schema.sql'), 'utf8');
      await withDatabase(database, async (pool) => {
        for (let pass = 0; pass < 2; pass += 1) {
          await pool.query('begin');
          try {
            await pool.query(schema);
            await pool.query('commit');
          } catch (error) {
            await pool.query('rollback');
            throw error;
          }
        }
      });
      const first = await runMigrator(database);
      assert.match(first.stdout, /APPLY 2026-08-08_schema_upgrade_safety\.sql/);
      const second = await runMigrator(database);
      assert.match(second.stdout, /SKIP 2026-08-08_schema_upgrade_safety\.sql/);
    });

    await t.test('v5.0.7 schema upgrades through forward migrations twice', async () => {
      let v507Schema;
      try {
        v507Schema = execFileSync('git', ['show', 'v5.0.7:sql/schema.sql'], {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024
        });
      } catch (_) {
        t.diagnostic('Local v5.0.7 tag is unavailable; tagged upgrade fixture skipped.');
        return;
      }
      const database = await createDatabase('v507');
      await withDatabase(database, async (pool) => {
        await pool.query('begin');
        try {
          await pool.query(v507Schema);
          await pool.query('commit');
        } catch (error) {
          await pool.query('rollback');
          throw error;
        }
      });
      const first = await runMigrator(database);
      assert.match(first.stdout, /APPLY 2026-08-08_schema_upgrade_safety\.sql/);
      const second = await runMigrator(database);
      assert.match(second.stdout, /SKIP 2026-08-08_schema_upgrade_safety\.sql/);
    });

    await t.test('legacy markers receive checksums once and then enforce drift protection', async () => {
      const database = await createDatabase('legacy_markers', base);
      await withDatabase(database, async (pool) => {
        await pool.query('alter table schema_migrations drop constraint schema_migrations_checksum_format_check');
        await pool.query('alter table schema_migrations alter column checksum drop not null');
        await pool.query('update schema_migrations set checksum = null');
      });
      const result = await runMigrator(database);
      assert.match(result.stdout, /BACKFILL CHECKSUM/);
      await withDatabase(database, async (pool) => {
        const catalog = await pool.query(`
          select a.attnotnull,
                 (select count(*)::int from schema_migrations where checksum is null) as null_count
          from pg_attribute a
          where a.attrelid = 'schema_migrations'::regclass and a.attname = 'checksum'
        `);
        assert.equal(catalog.rows[0].attnotnull, true);
        assert.equal(catalog.rows[0].null_count, 0);
      });
    });

    await t.test('wrong same-name indexes are replaced and concurrent migrators serialize', async () => {
      const database = await createDatabase('indexes', base);
      await withDatabase(database, async (pool) => {
        await pool.query('delete from schema_migrations where version = $1', [correctionVersion]);
        await pool.query('drop index idx_password_reset_requests_pending_user');
        await pool.query("create index idx_password_reset_requests_pending_user on password_reset_requests(user_id) where status = 'pending'");
        await pool.query('drop index idx_legacy_import_runs_active_hash');
        await pool.query("create index idx_legacy_import_runs_active_hash on legacy_import_runs(source_sha256) where status = 'running'");
      });
      const [first, second] = await Promise.all([runMigrator(database), runMigrator(database)]);
      assert.match(`${first.stdout}\n${second.stdout}`, /APPLY 2026-08-08_schema_upgrade_safety\.sql/);
      assert.match(`${first.stdout}\n${second.stdout}`, /SKIP 2026-08-08_schema_upgrade_safety\.sql/);
      await withDatabase(database, async (pool) => {
        const result = await pool.query(`
          select c.relname, i.indisunique, pg_get_expr(i.indpred, i.indrelid) as predicate
          from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relname = any($1::text[])
          order by c.relname
        `, [['idx_legacy_import_runs_active_hash', 'idx_password_reset_requests_pending_user']]);
        assert.equal(result.rowCount, 2);
        assert.ok(result.rows.every((row) => row.indisunique));
        assert.match(result.rows[0].predicate, /completed/);
        assert.match(result.rows[1].predicate, /user_id IS NOT NULL/);
      });
    });

    await t.test('wrong expires_at type fails and rolls back the correction marker', async () => {
      const database = await createDatabase('wrong_type', base);
      await withDatabase(database, async (pool) => {
        await pool.query('delete from schema_migrations where version = $1', [correctionVersion]);
        await pool.query('drop index idx_password_reset_requests_pending_expiry');
        await pool.query('alter table password_reset_requests alter column expires_at drop default');
        await pool.query('alter table password_reset_requests alter column expires_at drop not null');
        await pool.query('alter table password_reset_requests alter column expires_at type text using expires_at::text');
      });
      const failure = await runMigrator(database, true);
      assert.match(`${failure.stderr || ''}${failure.message || ''}`, /expires_at has type text, expected timestamp with time zone/i);
      await withDatabase(database, async (pool) => {
        const column = await pool.query(`
          select format_type(a.atttypid, a.atttypmod) as data_type
          from pg_attribute a
          where a.attrelid = 'password_reset_requests'::regclass and a.attname = 'expires_at'
        `);
        const marker = await pool.query('select 1 from schema_migrations where version = $1', [correctionVersion]);
        assert.equal(column.rows[0].data_type, 'text');
        assert.equal(marker.rowCount, 0);
      });
    });

    await t.test('an incomplete legacy_import_runs table is safely completed', async () => {
      const database = await createDatabase('incomplete_import', base);
      await withDatabase(database, async (pool) => {
        await pool.query('delete from schema_migrations where version = $1', [correctionVersion]);
        await pool.query('drop table legacy_import_runs cascade');
        await pool.query(`create table legacy_import_runs (
          id uuid primary key default gen_random_uuid(),
          source_sha256 text,
          status text default 'running'
        )`);
      });
      await runMigrator(database);
      await withDatabase(database, async (pool) => {
        const columns = await pool.query(`
          select column_name, data_type, is_nullable, column_default
          from information_schema.columns
          where table_schema = 'public' and table_name = 'legacy_import_runs'
        `);
        const byName = new Map(columns.rows.map((row) => [row.column_name, row]));
        for (const column of ['source_name', 'source_sha256', 'source_format', 'status', 'options', 'summary', 'created_at']) {
          assert.equal(byName.get(column)?.is_nullable, 'NO');
        }
        assert.equal(byName.get('options')?.data_type, 'jsonb');
        assert.match(byName.get('options')?.column_default || '', /jsonb/);
      });
    });

    await t.test('non-standard old password status CHECK is removed and expired becomes writable', async () => {
      const database = await createDatabase('old_check', base);
      await withDatabase(database, async (pool) => {
        await pool.query('delete from schema_migrations where version = $1', [correctionVersion]);
        await pool.query('alter table password_reset_requests drop constraint password_reset_requests_status_check');
        await pool.query(`alter table password_reset_requests add constraint custom_legacy_reset_state
          check (status in ('pending','approved','rejected','cancelled'))`);
      });
      await runMigrator(database);
      await withDatabase(database, async (pool) => {
        const user = await pool.query(`insert into users (name, phone, password_hash, password_salt, status)
          values ('Reset Test', $1, 'hash', 'salt', 'active') returning id`, [`reset-${Date.now()}`]);
        const request = await pool.query(`insert into password_reset_requests
          (user_id, submitted_phone, submitted_name, submitted_student_no, submitted_mentor_name)
          values ($1, '1', 'Reset Test', 'S1', 'Mentor') returning id`, [user.rows[0].id]);
        await pool.query("update password_reset_requests set status = 'expired' where id = $1", [request.rows[0].id]);
        const constraints = await pool.query(`
          select c.conname
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
          where c.conrelid = 'password_reset_requests'::regclass and c.contype = 'c' and a.attname = 'status'
        `);
        assert.deepEqual(constraints.rows.map((row) => row.conname), ['password_reset_requests_status_check']);
      });
    });

    await t.test('soft-deleted devices remain absent after upgrade validation', async () => {
      await withDatabase(base, async (pool) => {
        const code = `DELETED-${Date.now()}`;
        await pool.query('insert into devices (device_code, name, deleted_at) values ($1, $2, now())', [code, 'Deleted Device']);
        const result = await pool.query('select 1 from device_usage_summary_view where device_code = $1', [code]);
        assert.equal(result.rowCount, 0);
        const view = await pool.query("select pg_get_viewdef('calendar_events_view'::regclass, true) as definition");
        assert.match(view.rows[0].definition, /reservation_item/);
        assert.match(view.rows[0].definition, /deleted_at IS NULL/);
      });
    });

    await t.test('checksum drift fails before applying anything', async () => {
      const database = await createDatabase('checksum', base);
      await withDatabase(database, async (pool) => {
        await pool.query("update schema_migrations set checksum = repeat('0', 64) where version = $1", [correctionVersion]);
      });
      const failure = await runMigrator(database, true);
      assert.match(`${failure.stderr || ''}${failure.message || ''}`, /checksum mismatch/i);
    });
  } finally {
    for (const database of databases.reverse()) {
      await admin.query(`drop database if exists ${quoteIdent(database)} with (force)`).catch(() => {});
    }
    await admin.end();
  }
});

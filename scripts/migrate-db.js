const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config({ quiet: true });

const root = path.resolve(__dirname, '..');
const schemaPath = path.join(root, 'sql', 'schema.sql');
const migrationsDir = path.join(root, 'sql', 'migrations');
const MIGRATION_LOCK_NAME = 'laboratory-management-system:schema-migrations:v1';
const SAFE_SEARCH_PATH = 'public, pg_temp';
const CANONICAL_ROLE_PERMISSIONS = {
  admin: [
    'audit.view', 'chat.announce', 'chat.kick', 'device.manage', 'device.view',
    'fault.manage', 'reservation.approve', 'reservation.change_plan', 'reservation.view',
    'return.confirm', 'return.export', 'return.image_review', 'return.view', 'stats.export',
    'stats.view', 'user.approve', 'user.manage'
  ],
  duty_admin: [
    'device.view', 'fault.manage', 'reservation.approve', 'reservation.view',
    'return.confirm', 'return.image_review', 'return.view'
  ],
  auditor: ['audit.view', 'device.view', 'reservation.view', 'return.view']
};

const CRITICAL_COLUMNS = {
  password_reset_requests: [
    ['id', 'uuid', true, 'gen_random_uuid'],
    ['user_id', 'uuid', false, null],
    ['submitted_phone', 'text', true, null],
    ['submitted_name', 'text', true, null],
    ['submitted_student_no', 'text', true, null],
    ['submitted_major', 'text', false, null],
    ['submitted_mentor_name', 'text', true, null],
    ['reason', 'text', false, null],
    ['status', 'text', true, "'pending'"],
    ['request_count', 'integer', true, '1'],
    ['reviewed_by', 'uuid', false, null],
    ['reviewed_at', 'timestamp with time zone', false, null],
    ['review_note', 'text', false, null],
    ['expires_at', 'timestamp with time zone', true, "now()+interval'7days'"],
    ['created_at', 'timestamp with time zone', true, 'now()'],
    ['updated_at', 'timestamp with time zone', true, 'now()']
  ],
  reservation_items: [
    ['no_show_reason_category', 'text', false, null]
  ],
  legacy_import_runs: [
    ['id', 'uuid', true, 'gen_random_uuid'],
    ['source_name', 'text', true, null],
    ['source_sha256', 'text', true, null],
    ['source_format', 'text', true, null],
    ['status', 'text', true, "'running'"],
    ['options', 'jsonb', true, "'{}'"],
    ['summary', 'jsonb', true, "'{}'"],
    ['error_message', 'text', false, null],
    ['created_by', 'uuid', false, null],
    ['created_at', 'timestamp with time zone', true, 'now()'],
    ['finished_at', 'timestamp with time zone', false, null]
  ]
};

const CRITICAL_INDEXES = [
  {
    name: 'idx_password_reset_requests_pending_user',
    table: 'password_reset_requests',
    columns: ['user_id'],
    unique: true,
    predicate: "status='pending'anduser_idisnotnull"
  },
  {
    name: 'idx_legacy_import_runs_active_hash',
    table: 'legacy_import_runs',
    columns: ['source_sha256'],
    unique: true,
    predicate: "status=anyarray['running','completed']"
  },
  {
    name: 'idx_user_notifications_level_user_time',
    table: 'user_notifications',
    columns: ['level', 'user_id', 'created_at'],
    unique: false,
    predicate: ''
  },
  {
    name: 'idx_chat_message_reads_user_conv',
    table: 'chat_message_reads',
    columns: ['user_id', 'read_at'],
    unique: false,
    predicate: ''
  },
  {
    name: 'idx_reservation_reminder_window',
    table: 'reservation_items',
    columns: ['status', 'start_time'],
    unique: false,
    predicate: "status='approved'"
  },
  {
    name: 'idx_borrow_reminder_window',
    table: 'borrow_records',
    columns: ['status', 'expected_return_time'],
    unique: false,
    predicate: "status='in_use'"
  },
  {
    name: 'idx_chat_conversations_expires_at',
    table: 'chat_conversations',
    columns: ['expires_at'],
    unique: false,
    predicate: 'expires_atisnotnull'
  }
];

function isForwardMigrationFile(file) {
  return String(file || '').toLowerCase().endsWith('.sql')
    && !/(?:^|[._-])rollback(?:[._-]|$)/i.test(String(file || ''));
}

function discoverMigrationFiles(directory) {
  return fs.readdirSync(directory)
    .filter(isForwardMigrationFile)
    .sort();
}

function normalizeMigrationSource(source) {
  return String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function migrationChecksum(source) {
  return crypto.createHash('sha256').update(normalizeMigrationSource(source), 'utf8').digest('hex');
}

function stripOuterTransactionWrapper(source) {
  const sql = normalizeMigrationSource(source);
  const match = sql.match(/^(\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*)begin\s*;([\s\S]*?)commit\s*;\s*$/i);
  return match ? `${match[1]}${match[2].trim()}\n` : sql;
}

function getMigrationConnectionString(env = process.env) {
  return String(env.MIGRATION_DATABASE_URL || env.DATABASE_URL || '').trim();
}

function envFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function runtimeRoleFromConnectionString(connectionString) {
  let parsed;
  try {
    parsed = new URL(String(connectionString || '').trim());
  } catch (error) {
    throw new Error(`DATABASE_URL must be a valid PostgreSQL URL before runtime grants can be applied: ${error.message}`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }
  let role;
  try {
    role = decodeURIComponent(parsed.username || '');
  } catch (_) {
    throw new Error('DATABASE_URL contains an invalid percent-encoded database role.');
  }
  if (!role) throw new Error('DATABASE_URL must include the runtime database role when separate migration credentials are used.');
  if (role.includes('\0')) throw new Error('DATABASE_URL contains an invalid runtime database role.');
  return role;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function grantRuntimeDatabasePrivileges(client, runtimeConnectionString) {
  const runtimeRole = runtimeRoleFromConnectionString(runtimeConnectionString);
  const ownerResult = await client.query('select current_user as role');
  const ownerRole = ownerResult.rows[0]?.role || '';
  if (!ownerRole) throw new Error('Could not determine the migration database role.');
  if (runtimeRole === ownerRole) {
    console.log(`SKIP runtime grants; migration and runtime role are both ${runtimeRole}.`);
    return;
  }

  const roleExists = await client.query('select 1 from pg_catalog.pg_roles where rolname = $1', [runtimeRole]);
  if (!roleExists.rowCount) {
    throw new Error(`Runtime database role ${runtimeRole} does not exist; create it before deployment grants are applied.`);
  }

  const runtimeIdentifier = quoteIdentifier(runtimeRole);
  const ownerIdentifier = quoteIdentifier(ownerRole);
  const statements = [
    `grant usage on schema public to ${runtimeIdentifier}`,
    `grant select, insert, update, delete on all tables in schema public to ${runtimeIdentifier}`,
    `grant usage, select, update on all sequences in schema public to ${runtimeIdentifier}`,
    `grant execute on all functions in schema public to ${runtimeIdentifier}`,
    `alter default privileges for role ${ownerIdentifier} in schema public grant select, insert, update, delete on tables to ${runtimeIdentifier}`,
    `alter default privileges for role ${ownerIdentifier} in schema public grant usage, select, update on sequences to ${runtimeIdentifier}`,
    `alter default privileges for role ${ownerIdentifier} in schema public grant execute on functions to ${runtimeIdentifier}`,
    `revoke insert, update, delete, truncate, references, trigger on table public.schema_migrations from ${runtimeIdentifier}`
  ];
  for (const statement of statements) await client.query(statement);
  console.log(`DONE runtime database grants for ${runtimeRole}.`);
}

function readMigrationFiles(directory = migrationsDir) {
  if (!fs.existsSync(directory)) return [];
  return discoverMigrationFiles(directory).map((file) => {
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    return {
      file,
      version: path.basename(file, '.sql'),
      source,
      checksum: migrationChecksum(source)
    };
  });
}

function normalizedExpression(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/'([^']+)'::interval/g, "interval'$1'")
    .replace(/::(?:text\[\]|text|jsonb|timestamp with time zone)/g, '')
    .replace(/[()\s"]/g, '');
}

async function beginMigrationTransaction(client) {
  await client.query('begin');
  await client.query(`set local search_path = ${SAFE_SEARCH_PATH}`);
  await client.query("set local lock_timeout = '15s'");
  await client.query("set local statement_timeout = '5min'");
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [MIGRATION_LOCK_NAME]);
}

async function ensureMigrationTable(client) {
  await client.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      checksum text,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query('alter table public.schema_migrations add column if not exists checksum text');

  const columns = await client.query(`
    select a.attname, format_type(a.atttypid, a.atttypmod) as data_type, a.attnotnull
    from pg_attribute a
    where a.attrelid = 'public.schema_migrations'::regclass
      and a.attnum > 0 and not a.attisdropped
  `);
  const byName = new Map(columns.rows.map((row) => [row.attname, row]));
  if (byName.get('version')?.data_type !== 'text') {
    throw new Error('schema_migrations.version must be text.');
  }
  if (byName.get('checksum')?.data_type !== 'text') {
    throw new Error('schema_migrations.checksum must be text.');
  }
  if (byName.get('applied_at')?.data_type !== 'timestamp with time zone' || !byName.get('applied_at')?.attnotnull) {
    throw new Error('schema_migrations.applied_at must be a NOT NULL timestamptz column.');
  }
  const primaryKey = await client.query(`
    select array_agg(a.attname order by key.ordinality)::text[] as columns
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as key(attnum, ordinality)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
    where c.conrelid = 'public.schema_migrations'::regclass and c.contype = 'p'
  `);
  if (JSON.stringify(primaryKey.rows[0]?.columns || []) !== JSON.stringify(['version'])) {
    throw new Error('schema_migrations must use version as its primary key.');
  }
}

async function dropMigrationChecksumChecks(client) {
  await client.query(`
    do $migration_checksum_checks$
    declare
      constraint_row record;
    begin
      for constraint_row in
        select distinct c.conname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.conrelid = 'public.schema_migrations'::regclass
          and c.contype = 'c'
          and a.attname = 'checksum'
      loop
        execute format('alter table public.schema_migrations drop constraint %I', constraint_row.conname);
      end loop;
    end
    $migration_checksum_checks$
  `);
}

async function isDatabaseEmpty(client) {
  const result = await client.query(`
    select count(*)::int as table_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname <> 'schema_migrations'
  `);
  return Number(result.rows[0]?.table_count || 0) === 0;
}

async function verifyAndBackfillAppliedChecksums(client, files) {
  await dropMigrationChecksumChecks(client);
  const expected = new Map(files.map((file) => [file.version, file]));
  const applied = await client.query('select version, checksum from public.schema_migrations order by version for update');

  for (const row of applied.rows) {
    const file = expected.get(row.version);
    if (!file) {
      throw new Error(`Applied migration ${row.version} has no matching forward migration file.`);
    }
    if (row.checksum && row.checksum !== file.checksum) {
      throw new Error(`Migration checksum mismatch for ${file.file}; an applied migration file has changed.`);
    }
    if (!row.checksum) {
      await client.query(
        'update public.schema_migrations set checksum = $2 where version = $1 and checksum is null',
        [row.version, file.checksum]
      );
      console.log(`BACKFILL CHECKSUM ${file.file}`);
    }
  }

  await client.query(`
    do $migration_checksum_constraint$
    begin
      if exists (select 1 from public.schema_migrations where checksum is null or checksum !~ '^[0-9a-f]{64}$') then
        raise exception 'schema_migrations contains an invalid checksum';
      end if;
      alter table public.schema_migrations alter column checksum set not null;
      alter table public.schema_migrations drop constraint if exists schema_migrations_checksum_format_check;
      alter table public.schema_migrations add constraint schema_migrations_checksum_format_check
        check (checksum ~ '^[0-9a-f]{64}$');
    end
    $migration_checksum_constraint$
  `);
}

async function applyBaseline(client, files, baselinePath = schemaPath) {
  if (!fs.existsSync(baselinePath)) throw new Error(`Schema baseline not found: ${baselinePath}`);
  const schema = normalizeMigrationSource(fs.readFileSync(baselinePath, 'utf8'));
  await beginMigrationTransaction(client);
  try {
    if (!(await isDatabaseEmpty(client))) {
      throw new Error('Database stopped being empty while waiting for the migration lock.');
    }
    const historyTable = await client.query("select to_regclass('public.schema_migrations') as relation");
    if (historyTable.rows[0]?.relation) {
      const existingHistory = await client.query('select count(*)::int as count from public.schema_migrations');
      if (Number(existingHistory.rows[0]?.count || 0) > 0) {
        throw new Error('Migration history exists but application tables are absent; refusing to overwrite history with a baseline.');
      }
    }
    console.log(`BASELINE ${path.relative(root, baselinePath)}`);
    await client.query(schema);
    await ensureMigrationTable(client);
    for (const file of files) {
      await client.query(
        `insert into public.schema_migrations (version, checksum)
         values ($1, $2)
         on conflict (version) do update set checksum = excluded.checksum`,
        [file.version, file.checksum]
      );
    }
    await verifyAndBackfillAppliedChecksums(client, files);
    await validateCriticalSchema(client);
    await client.query('commit');
    console.log('DONE schema baseline');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function applyPendingMigrations(client, files) {
  const completedMessages = [];
  await beginMigrationTransaction(client);
  try {
    await ensureMigrationTable(client);
    for (const file of files) {
      const applied = await client.query(
        'select checksum from public.schema_migrations where version = $1 for update',
        [file.version]
      );
      if (applied.rowCount) {
        const checksum = applied.rows[0].checksum;
        if (checksum && checksum !== file.checksum) {
          throw new Error(`Migration checksum mismatch for ${file.file}; an applied migration file has changed.`);
        }
        if (!checksum) {
          await client.query('update public.schema_migrations set checksum = $2 where version = $1', [file.version, file.checksum]);
          completedMessages.push(`BACKFILL CHECKSUM ${file.file}`);
        }
        completedMessages.push(`SKIP ${file.file}`);
        continue;
      }

      console.log(`APPLY ${file.file}`);
      await client.query(stripOuterTransactionWrapper(file.source));
      await client.query(
        'insert into public.schema_migrations (version, checksum) values ($1, $2)',
        [file.version, file.checksum]
      );
      completedMessages.push(`DONE ${file.file}`);
    }
    await client.query('commit');
    for (const message of completedMessages) console.log(message);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function assertCriticalColumns(client) {
  for (const [table, expectedColumns] of Object.entries(CRITICAL_COLUMNS)) {
    const exists = await client.query('select to_regclass($1) as relation', [`public.${table}`]);
    if (!exists.rows[0]?.relation) throw new Error(`Required table public.${table} is missing.`);

    const result = await client.query(`
      select a.attname,
             format_type(a.atttypid, a.atttypmod) as data_type,
             a.attnotnull,
             pg_get_expr(d.adbin, d.adrelid) as column_default
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
    `, [`public.${table}`]);
    const actual = new Map(result.rows.map((row) => [row.attname, row]));

    for (const [column, dataType, notNull, defaultPart] of expectedColumns) {
      const info = actual.get(column);
      if (!info) throw new Error(`Required column ${table}.${column} is missing.`);
      if (info.data_type !== dataType) {
        throw new Error(`Column ${table}.${column} has type ${info.data_type}; expected ${dataType}.`);
      }
      if (Boolean(info.attnotnull) !== notNull) {
        throw new Error(`Column ${table}.${column} has an invalid NOT NULL setting.`);
      }
      if (defaultPart && !normalizedExpression(info.column_default).includes(normalizedExpression(defaultPart))) {
        throw new Error(`Column ${table}.${column} has an invalid default expression.`);
      }
    }
  }
}

async function assertCriticalIndexes(client) {
  for (const expected of CRITICAL_INDEXES) {
    const result = await client.query(`
      select i.indisunique, i.indisvalid, i.indisready, am.amname as access_method,
             array(
               select a.attname
               from unnest(i.indkey::smallint[]) with ordinality as key(attnum, ordinality)
               join pg_attribute a on a.attrelid = i.indrelid and a.attnum = key.attnum
               where key.ordinality <= i.indnkeyatts
               order by key.ordinality
             )::text[] as columns,
             pg_get_expr(i.indpred, i.indrelid) as predicate
      from pg_class idx
      join pg_namespace ns on ns.oid = idx.relnamespace
      join pg_index i on i.indexrelid = idx.oid
      join pg_am am on am.oid = idx.relam
      where ns.nspname = 'public' and idx.relname = $1
        and i.indrelid = $2::regclass
    `, [expected.name, `public.${expected.table}`]);
    if (result.rowCount !== 1) throw new Error(`Required index ${expected.name} is missing or attached to the wrong table.`);
    const row = result.rows[0];
    if (Boolean(row.indisunique) !== expected.unique) throw new Error(`Index ${expected.name} has an invalid uniqueness setting.`);
    if (!row.indisvalid || !row.indisready || row.access_method !== 'btree') throw new Error(`Index ${expected.name} is not a valid ready btree index.`);
    if (JSON.stringify(row.columns) !== JSON.stringify(expected.columns)) throw new Error(`Index ${expected.name} has invalid key columns.`);
    const predicate = normalizedExpression(row.predicate);
    if (predicate !== expected.predicate) {
      throw new Error(`Index ${expected.name} has an invalid partial-index predicate.`);
    }
  }
}

async function assertCanonicalStatusConstraint(client, table, allowedStatuses) {
  const result = await client.query(`
    select c.conname, pg_get_constraintdef(c.oid, true) as definition
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = $1::regclass and c.contype = 'c' and a.attname = 'status'
    order by c.conname
  `, [`public.${table}`]);
  if (result.rowCount !== 1) throw new Error(`Table ${table} must have exactly one status CHECK constraint.`);
  const definition = normalizedExpression(result.rows[0].definition);
  const expectedDefinition = `checkstatus=anyarray[${allowedStatuses.map((status) => `'${status}'`).join(',')}]`;
  if (definition !== expectedDefinition) {
    throw new Error(`Table ${table} does not have the canonical status CHECK constraint.`);
  }
}

async function validateCriticalSchema(client) {
  await assertCriticalColumns(client);
  await assertCriticalIndexes(client);
  await assertCanonicalStatusConstraint(
    client,
    'password_reset_requests',
    ['pending', 'approved', 'rejected', 'cancelled', 'expired']
  );
  await assertCanonicalStatusConstraint(client, 'legacy_import_runs', ['running', 'completed', 'failed']);

  const views = await client.query(`
    select viewname, pg_get_viewdef(format('%I.%I', schemaname, viewname)::regclass, true) as definition
    from pg_views
    where schemaname = 'public' and viewname = any($1::text[])
  `, [['calendar_events_view', 'device_usage_summary_view']]);
  const byName = new Map(views.rows.map((row) => [row.viewname, normalizedExpression(row.definition)]));
  const calendar = byName.get('calendar_events_view') || '';
  const usage = byName.get('device_usage_summary_view') || '';
  if (!calendar.includes("'reservation_item'")
    || ['ri.deleted_atisnull', 'd.deleted_atisnull', 'u.deleted_atisnull', 'b.deleted_atisnull']
      .some((fragment) => !calendar.includes(fragment))) {
    throw new Error('calendar_events_view is not the canonical soft-delete-safe definition.');
  }
  if (!usage.includes('devicesd') || !usage.includes('reservationsr') || usage.includes('reservation_itemsr')
    || ['d.deleted_atisnull', 'r.deleted_atisnull', 'b.deleted_atisnull', 'f.deleted_atisnull']
      .some((fragment) => !usage.includes(fragment))) {
    throw new Error('device_usage_summary_view is not the canonical soft-delete-safe definition.');
  }

  const legacyRoles = await client.query("select count(*)::int as count from roles where role_key = 'ops'");
  const legacyAssignments = await client.query("select count(*)::int as count from admin_roles where role_key = 'ops'");
  if (legacyRoles.rows[0].count || legacyAssignments.rows[0].count) {
    throw new Error('Legacy ops roles must be migrated to duty_admin.');
  }
  for (const [roleKey, expectedPermissions] of Object.entries(CANONICAL_ROLE_PERMISSIONS)) {
    const result = await client.query(`
      select array_agg(rp.permission_key order by rp.permission_key)::text[] as permissions
      from roles r
      left join role_permissions rp on rp.role_id = r.id
      where r.role_key = $1
      group by r.id
    `, [roleKey]);
    if (result.rowCount !== 1 || JSON.stringify(result.rows[0].permissions || []) !== JSON.stringify(expectedPermissions)) {
      throw new Error(`Role ${roleKey} does not match the canonical permission catalog.`);
    }
  }
}

async function migrateDatabase(options = {}) {
  const connectionString = options.connectionString || getMigrationConnectionString(options.env || process.env);
  if (!connectionString) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is not configured.');

  const files = options.files || readMigrationFiles(options.migrationsDir || migrationsDir);
  const pool = options.pool || new Pool({
    connectionString,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });
  const ownsPool = !options.pool;
  const client = await pool.connect();
  let sessionLockHeld = false;
  try {
    await client.query(`set search_path = ${SAFE_SEARCH_PATH}`);
    await client.query("set application_name = 'laboratory-management-system-migrator'");
    await client.query("set lock_timeout = '15s'");
    await client.query("set statement_timeout = '5min'");
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [MIGRATION_LOCK_NAME]);
    sessionLockHeld = true;

    if (options.baselineIfEmpty !== false && await isDatabaseEmpty(client)) {
      await applyBaseline(client, files, options.schemaPath || schemaPath);
    } else {
      await beginMigrationTransaction(client);
      try {
        await ensureMigrationTable(client);
        await verifyAndBackfillAppliedChecksums(client, files);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      }
      await applyPendingMigrations(client, files);
    }

    await beginMigrationTransaction(client);
    try {
      await ensureMigrationTable(client);
      await verifyAndBackfillAppliedChecksums(client, files);
      await validateCriticalSchema(client);
      const migrationEnv = options.env || process.env;
      const shouldGrantRuntime = options.grantRuntimePrivileges === undefined
        ? envFlagEnabled(migrationEnv.GRANT_RUNTIME_DATABASE_PRIVILEGES)
        : Boolean(options.grantRuntimePrivileges);
      if (shouldGrantRuntime) {
        const runtimeConnectionString = options.runtimeConnectionString || String(migrationEnv.DATABASE_URL || '').trim();
        if (!runtimeConnectionString) throw new Error('DATABASE_URL is required when runtime database grants are enabled.');
        await grantRuntimeDatabasePrivileges(client, runtimeConnectionString);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
    console.log('Database migrations and catalog validation completed.');
  } finally {
    if (sessionLockHeld) {
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [MIGRATION_LOCK_NAME]).catch(() => {});
    }
    client.release();
    if (ownsPool) await pool.end();
  }
}

async function main() {
  await migrateDatabase();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  CANONICAL_ROLE_PERMISSIONS,
  CRITICAL_COLUMNS,
  CRITICAL_INDEXES,
  MIGRATION_LOCK_NAME,
  SAFE_SEARCH_PATH,
  envFlagEnabled,
  grantRuntimeDatabasePrivileges,
  discoverMigrationFiles,
  getMigrationConnectionString,
  isForwardMigrationFile,
  migrateDatabase,
  migrationChecksum,
  normalizeMigrationSource,
  quoteIdentifier,
  runtimeRoleFromConnectionString,
  readMigrationFiles,
  stripOuterTransactionWrapper,
  validateCriticalSchema
};

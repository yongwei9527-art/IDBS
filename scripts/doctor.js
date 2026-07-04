const { Pool } = require('pg');
require('dotenv').config();

const checks = [];

function pass(name, detail = '') {
  checks.push({ ok: true, name, detail });
  console.log(`PASS ${name}${detail ? ` -> ${detail}` : ''}`);
}

function fail(name, detail = '') {
  checks.push({ ok: false, name, detail });
  console.log(`FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  process.exitCode = 1;
}

function warn(name, detail = '') {
  checks.push({ ok: true, warning: true, name, detail });
  console.log(`WARN ${name}${detail ? ` -> ${detail}` : ''}`);
}

async function queryOne(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function relationExists(pool, name) {
  const row = await queryOne(pool, 'select to_regclass($1) as name', [`public.${name}`]);
  return Boolean(row?.name);
}

async function columnExists(pool, table, column) {
  const row = await queryOne(pool, `
    select 1 as ok
    from information_schema.columns
    where table_schema = 'public' and table_name = $1 and column_name = $2
    limit 1
  `, [table, column]);
  return Boolean(row);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || '';
  if (!databaseUrl) {
    fail('DATABASE_URL', 'not configured');
    return;
  }
  pass('DATABASE_URL', 'configured');

  if (!process.env.ADMIN_PASSWORD) warn('ADMIN_PASSWORD', 'not configured; admin console password login may fail');
  else pass('ADMIN_PASSWORD', 'configured');

  if (!process.env.TOKEN_SECRET || process.env.TOKEN_SECRET === 'change-me-please') {
    warn('TOKEN_SECRET', 'missing or default value');
  } else {
    pass('TOKEN_SECRET', 'configured');
  }

  const corsOrigin = process.env.CORS_ORIGIN || '';
  if (!corsOrigin) {
    warn('CORS_ORIGIN', 'not configured; default runtime allows all origins');
  } else if (/\uFFFD/.test(corsOrigin)) {
    warn('CORS_ORIGIN', `looks corrupted: ${corsOrigin}`);
  } else if (corsOrigin !== '*' && !/^https?:\/\//i.test(corsOrigin)) {
    warn('CORS_ORIGIN', `should include http:// or https://: ${corsOrigin}`);
  } else {
    pass('CORS_ORIGIN', corsOrigin);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000
  });

  try {
    const health = await queryOne(pool, 'select 1 as ok');
    if (health?.ok === 1) pass('PostgreSQL connection');
    else fail('PostgreSQL connection', 'unexpected response');

    const encoding = await queryOne(pool, 'show server_encoding');
    const clientEncoding = await queryOne(pool, 'show client_encoding');
    pass('PostgreSQL encoding', `server=${encoding?.server_encoding || '-'}, client=${clientEncoding?.client_encoding || '-'}`);

    const requiredTables = [
      'users',
      'devices',
      'device_time_slots',
      'reservation_batches',
      'reservation_items',
      'borrow_records',
      'device_fault_reports',
      'user_requests',
      'user_notifications',
      'chat_conversations',
      'chat_participants',
      'chat_messages',
      'chat_message_reads',
      'permissions',
      'roles',
      'role_permissions',
      'user_roles',
      'operation_logs',
      'export_jobs',
      'system_configs',
      'wechat_push_logs',
      'usage_log'
    ];
    for (const table of requiredTables) {
      if (await relationExists(pool, table)) pass(`table ${table}`);
      else fail(`table ${table}`, 'missing');
    }

    const requiredViews = ['calendar_events_view', 'device_usage_summary_view'];
    for (const relation of requiredViews) {
      if (await relationExists(pool, relation)) pass(`upgrade relation ${relation}`);
      else fail(`upgrade relation ${relation}`, 'missing');
    }

    const requiredColumns = [
      ['users', 'avatar_url'],
      ['users', 'department'],
      ['users', 'last_active_at'],
      ['users', 'disabled_reason'],
      ['users', 'approved_by'],
      ['users', 'approved_at'],
      ['operation_logs', 'target_type'],
      ['operation_logs', 'target_id'],
      ['operation_logs', 'ip_address'],
      ['export_jobs', 'type'],
      ['export_jobs', 'params'],
      ['export_jobs', 'status'],
      ['export_jobs', 'created_by'],
      ['export_jobs', 'finished_at'],
      ['borrow_records', 'reservation_item_id'],
      ['borrow_records', 'actual_start_time'],
      ['borrow_records', 'actual_end_time'],
      ['reservation_batches', 'submit_note'],
      ['reservation_batches', 'admin_note'],
      ['device_fault_reports', 'severity'],
      ['device_fault_reports', 'handled_by'],
      ['device_fault_reports', 'handled_at'],
      ['device_fault_reports', 'reservation_item_id'],
      ['chat_conversations', 'system_key'],
      ['chat_conversations', 'is_system'],
      ['chat_conversations', 'retention_days'],
      ['chat_messages', 'message_type'],
      ['chat_messages', 'attachments'],
      ['chat_messages', 'metadata'],
      ['chat_messages', 'related_type'],
      ['chat_messages', 'related_id'],
      ['chat_messages', 'client_message_id'],
      ['chat_messages', 'delivery_status'],
      ['usage_log', 'reservation_item_id']
    ];
    for (const [table, column] of requiredColumns) {
      if (!(await relationExists(pool, table))) {
        fail(`${table}.${column}`, 'table missing');
      } else if (await columnExists(pool, table, column)) {
        pass(`${table}.${column}`);
      } else {
        fail(`${table}.${column}`, 'missing from IDBS 2.0 baseline');
      }
    }

    const reservationItemConstraint = await queryOne(pool, "select conname from pg_constraint where conname = 'reservation_items_no_overlap_active' limit 1");
    if (reservationItemConstraint) pass('constraint reservation_items_no_overlap_active');
    else fail('constraint reservation_items_no_overlap_active', 'missing');

    const counts = await pool.query(`
      select 'users' as name, count(*)::int as count from users
      union all select 'devices', count(*)::int from devices
      union all select 'reservation_items', count(*)::int from reservation_items
      union all select 'borrow_records', count(*)::int from borrow_records
    `);
    for (const row of counts.rows) pass(`count ${row.name}`, String(row.count));
  } catch (error) {
    fail('doctor failed', error.message || String(error));
  } finally {
    await pool.end().catch(() => {});
  }

  const failed = checks.filter((item) => !item.ok).length;
  const warnings = checks.filter((item) => item.warning).length;
  console.log(`Doctor finished: ${failed} failed, ${warnings} warning(s).`);

  if (failed) {
    console.log('Hint: IDBS 2.0 requires a fresh baseline. Back up data, then run: RESET_IDBS_SCHEMA=1 npm run db:reset-schema');
    console.log('Hint: for non-local databases, also set ALLOW_PRODUCTION_SCHEMA_RESET=1 only after a verified backup.');
    console.log('Hint: if preserving existing data, run npm run db:upgrade-schema and apply its Manual SQL block with a PostgreSQL table owner/admin account.');
  }
}

main().catch((error) => {
  fail('doctor crashed', error.message || String(error));
});

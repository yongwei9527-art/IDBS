const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
const { isPlaceholderSecret, isWeakAdminPassword } = require('../src/config/env');
require('dotenv').config({ quiet: true });

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

async function tableOwner(pool, table) {
  const row = await queryOne(pool, `select tableowner from pg_tables where schemaname = 'public' and tablename = $1 limit 1`, [table]);
  return row?.tableowner || '';
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
    fail('DATABASE_URL', '未配置');
    return;
  }
  pass('DATABASE_URL', '已配置');

  const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';
  if (!process.env.ADMIN_PASSWORD) (isProduction ? fail : warn)('ADMIN_PASSWORD', '未配置；生产环境必须设置强管理员密码');
  else if (isWeakAdminPassword(process.env.ADMIN_PASSWORD)) (isProduction ? fail : warn)('ADMIN_PASSWORD', '长度不足 12 位或仍为占位/弱密码，请改为强密码');
  else pass('ADMIN_PASSWORD', '已配置');

  if (!process.env.TOKEN_SECRET || isPlaceholderSecret(process.env.TOKEN_SECRET)) {
    (isProduction ? fail : warn)('TOKEN_SECRET', '缺失或仍为默认值；生产环境必须使用至少 32 位随机密钥');
  } else if (String(process.env.TOKEN_SECRET).length < 32) {
    (isProduction ? fail : warn)('TOKEN_SECRET', '长度不足 32 位，建议改为更长随机密钥');
  } else {
    pass('TOKEN_SECRET', '已配置');
  }

  const corsOrigin = process.env.CORS_ORIGIN || '';
  if (!corsOrigin) {
    (String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? fail : warn)('CORS_ORIGIN', '未配置；默认会放开跨域，生产环境请填写真实域名');
  } else if (/\uFFFD/.test(corsOrigin)) {
    warn('CORS_ORIGIN', `looks corrupted: ${corsOrigin}`);
  } else if (corsOrigin !== '*' && !/^https?:\/\//i.test(corsOrigin)) {
    warn('CORS_ORIGIN', `should include http:// or https://: ${corsOrigin}`);
  } else if (corsOrigin === '*' && String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    fail('CORS_ORIGIN', '生产环境不建议使用 *，请填写真实域名');
  } else {
    pass('CORS_ORIGIN', corsOrigin);
  }

  if (String(process.env.PGSSL || '').toLowerCase() === 'true'
    && String(process.env.PGSSL_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'false') {
    (isProduction ? fail : warn)('PGSSL_REJECT_UNAUTHORIZED', '数据库 TLS 证书校验已关闭');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });

  try {
    const health = await queryOne(pool, 'select 1 as ok');
    if (health?.ok === 1) pass('数据库连接');
    else fail('数据库连接', '数据库响应异常');

    const encoding = await queryOne(pool, 'show server_encoding');
    const clientEncoding = await queryOne(pool, 'show client_encoding');
    pass('数据库编码', `服务端=${encoding?.server_encoding || '-'}, 客户端=${clientEncoding?.client_encoding || '-'}`);

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
      'usage_log',
      'audit_logs',
      'user_wechat_bindings',
      'intelligence_action_logs',
      'refresh_token_sessions',
      'scheduled_job_runs',
      'rate_limit_buckets',
      'device_maintenance_plans',
      'device_maintenance_windows',
      'device_maintenance_work_orders'
    ];
    for (const table of requiredTables) {
      if (await relationExists(pool, table)) pass(`table ${table}`);
      else fail(`table ${table}`, '缺失');
    }

    const requiredViews = ['calendar_events_view', 'device_usage_summary_view'];
    for (const relation of requiredViews) {
      if (await relationExists(pool, relation)) pass(`upgrade relation ${relation}`);
      else fail(`upgrade relation ${relation}`, '缺失');
    }

    const requiredV5Indexes = [
      'idx_refresh_token_sessions_subject',
      'idx_refresh_token_sessions_expiry',
      'idx_scheduled_job_runs_name_time',
      'idx_rate_limit_buckets_expiry',
      'idx_reservation_items_pending_time',
      'idx_borrow_records_active_due',
      'idx_borrow_records_material_deadline',
      'idx_users_pending_active',
      'idx_maintenance_plans_due',
      'idx_maintenance_windows_device_time',
      'idx_maintenance_windows_lifecycle',
      'idx_maintenance_work_orders_status_time',
      'idx_export_jobs_worker_queue',
      'idx_export_jobs_expired_files'
    ];
    for (const index of requiredV5Indexes) {
      if (await relationExists(pool, index)) pass(`v5 index ${index}`);
      else fail(`v5 index ${index}`, '缺失');
    }

    const requiredColumns = [
      ['users', 'deleted_at'],
      ['devices', 'deleted_at'],
      ['devices', 'created_by'],
      ['devices', 'updated_by'],
      ['reservations', 'deleted_at'],
      ['reservations', 'created_by'],
      ['reservations', 'updated_by'],
      ['reservation_items', 'deleted_at'],
      ['reservation_items', 'created_by'],
      ['reservation_items', 'updated_by'],
      ['reservation_batches', 'deleted_at'],
      ['reservation_batches', 'updated_by'],
      ['borrow_records', 'deleted_at'],
      ['borrow_records', 'updated_by'],
      ['device_fault_reports', 'deleted_at'],
      ['device_fault_reports', 'updated_by'],
      ['user_requests', 'deleted_at'],
      ['user_requests', 'updated_by'],
      ['borrow_records', 'return_archive_photos'],
      ['borrow_records', 'return_archive_folder'],
      ['borrow_records', 'return_material_required'],
      ['borrow_records', 'return_material_deadline'],
      ['borrow_records', 'return_supplement_note'],
      ['borrow_records', 'return_supplement_photos'],
      ['borrow_records', 'return_supplemented_at'],
      ['borrow_records', 'return_material_late'],
      ['devices', 'return_require_note'],
      ['devices', 'return_mode'],
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
      ['export_jobs', 'attempt_count'],
      ['export_jobs', 'max_attempts'],
      ['export_jobs', 'available_at'],
      ['export_jobs', 'worker_id'],
      ['export_jobs', 'lease_token'],
      ['export_jobs', 'lease_expires_at'],
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
        fail(`${table}.${column}`, '表缺失');
      } else if (await columnExists(pool, table, column)) {
        pass(`${table}.${column}`);
      } else {
        const owner = await tableOwner(pool, table);
        fail(`${table}.${column}`, owner ? `缺失；当前表 owner 为 ${owner}，请使用表 owner/超级用户执行 npm run db:upgrade-schema 或手工 SQL` : '缺失');
      }
    }

    const reservationItemConstraint = await queryOne(pool, "select conname from pg_constraint where conname = 'reservation_items_no_overlap_active' limit 1");
    if (reservationItemConstraint) pass('constraint reservation_items_no_overlap_active');
    else fail('constraint reservation_items_no_overlap_active', '缺失');

    const counts = await pool.query(`
      select 'users' as name, count(*)::int as count from users
      union all select 'devices', count(*)::int from devices
      union all select 'reservation_items', count(*)::int from reservation_items
      union all select 'borrow_records', count(*)::int from borrow_records
    `);
    for (const row of counts.rows) pass(`count ${row.name}`, String(row.count));

    // ----- versioned migration checks -----
    const ownerRows = await pool.query(`
      select tablename, tableowner
      from pg_tables
      where schemaname = 'public'
        and tablename in ('users','devices','borrow_records','reservation_batches','operation_logs','usage_log')
      order by tablename
    `);
    const owners = [...new Set(ownerRows.rows.map((row) => row.tableowner).filter(Boolean))];
    if (owners.length) pass('table owners', owners.join(', '));

    const v3ConfigKeys = ['schema_v3_applied_at', 'jwt_access_ttl_minutes'];
    for (const key of v3ConfigKeys) {
      const row = await queryOne(pool, 'select 1 as ok from system_configs where config_key = $1 limit 1', [key]);
      if (row?.ok === 1) pass(`v3 config ${key}`);
      else warn(`v3 config ${key}`, '缺失，迁移可能尚未导入');
    }

    const v5Marker = await queryOne(pool, "select config_value from system_configs where config_key = 'schema_v5_applied_at' limit 1");
    if (v5Marker?.config_value) pass('v5 config schema_v5_applied_at', v5Marker.config_value);
    else fail('v5 config schema_v5_applied_at', '缺失，请执行 5.0 数据库升级');
  } catch (error) {
    fail('系统自检失败', error.message || String(error));
  } finally {
    
  // Database backup freshness / integrity
  try {
    const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups', 'db'));
    if (!fs.existsSync(backupDir)) {
      warn('Database backup directory', 'missing ' + backupDir + '; run npm run db:backup');
    } else {
      const files = fs.readdirSync(backupDir)
        .filter((name) => /^idbs-\d{8}T\d{6}Z\.(dump|sql)$/.test(name))
        .map((name) => {
          const full = path.join(backupDir, name);
          const st = fs.statSync(full);
          return { name, full, mtimeMs: st.mtimeMs, size: st.size };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (!files.length) {
        warn('Database backup freshness', 'no dump files in ' + backupDir + '; run npm run db:backup');
      } else {
        const latest = files[0];
        const ageHours = (Date.now() - latest.mtimeMs) / 3600000;
        const manifestPath = latest.full + '.json';
        if (!fs.existsSync(manifestPath)) {
          warn('Database backup manifest', 'missing manifest for ' + latest.name);
        } else {
          try {
            const meta = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const hash = crypto.createHash('sha256').update(fs.readFileSync(latest.full)).digest('hex');
            if (meta.sha256 && meta.sha256 !== hash) fail('Database backup integrity', 'checksum mismatch for ' + latest.name);
            else pass('Database backup integrity', latest.name);
          } catch (error) {
            warn('Database backup manifest', error.message || String(error));
          }
        }
        if (ageHours > 36) warn('Database backup freshness', 'latest ' + latest.name + ' is ' + ageHours.toFixed(1) + 'h old');
        else pass('Database backup freshness', latest.name + ' (' + ageHours.toFixed(1) + 'h old, ' + latest.size + ' bytes)');
      }
    }
  } catch (error) {
    warn('Database backup check', error.message || String(error));
  }

    await pool.end().catch(() => {});
  }

  const failed = checks.filter((item) => !item.ok).length;
  const warnings = checks.filter((item) => item.warning).length;
  console.log(`系统自检完成：${failed} 项失败，${warnings} 项警告。`);

  if (failed) {
    const v3Missing = checks.some((item) => !item.ok || (item.warning && String(item.name).startsWith('v3 ')));
    console.log('提示：请先备份数据库。保留数据升级时，使用表 owner/超级用户执行 npm run db:upgrade-schema，并应用脚本输出的 手工 SQL。');
    console.log('提示：仅在已确认备份且允许重建测试库时，才可执行 RESET_IDBS_SCHEMA=1 npm run db:reset-schema。');
    if (v3Missing) {
      console.log('提示：如来自旧库，请应用 sql/migrations/2026-07-04_v3_foundation.sql，再运行 npm run db:migrate-2-to-3:import。');
    }
  }

  // Frontend build freshness
  const v5Index = path.join(process.cwd(), 'public', 'v5', 'index.html');
  if (!fs.existsSync(v5Index)) {
    warn('public/v5', 'missing production frontend build; run npm run v5:build');
  } else {
    const ageHours = (Date.now() - fs.statSync(v5Index).mtimeMs) / 3600000;
    if (ageHours > 24 * 14) warn('public/v5', `index.html is ${ageHours.toFixed(1)} hours old; rebuild if frontend changed`);
    else pass('public/v5', 'frontend build present');
  }

  const statementTimeout = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 30000);
  if (!Number.isFinite(statementTimeout) || statementTimeout < 1000) warn('PG_STATEMENT_TIMEOUT_MS', 'should be >= 1000');
  else pass('PG_STATEMENT_TIMEOUT_MS', String(statementTimeout));

}

main().catch((error) => {
  fail('系统自检异常', error.message || String(error));
});









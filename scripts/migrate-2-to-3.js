/**
 * IDBS 2.x → 3.0 数据迁移辅助脚本。
 *
 * 设计目标：
 * - 不假设 2.x 与 3.0 在同一数据库；从源库读取，写入目标库。
 * - 提供 dry-run：只统计每表行数，不写入。
 * - 提供导出：把源库关键表导出为 JSON 文件，便于人工核对或离线导入。
 * - 提供导入：把导出的 JSON 写入目标库（upsert，idempotent）。
 * - 默认只读源库、只写目标库；缺目标库时降级为只导出。
 *
 * 用法：
 *   node scripts/migrate-2-to-3.js --check                 # 检查两库连通 + 行数对照
 *   node scripts/migrate-2-to-3.js --export                # 导出源库到 sql/seed/v5-export/*.json
 *   node scripts/migrate-2-to-3.js --import                # 从导出 JSON 写入目标库
 *   node scripts/migrate-2-to-3.js --export --import       # 导出后立即导入
 *
 * 环境变量：
 *   SOURCE_DATABASE_URL   2.x 源库连接串（必填）
 *   TARGET_DATABASE_URL   3.0 目标库连接串（import 时必填，export 可空）
 *   MIGRATE_DRY_RUN=1     任何模式下先做只读检查
 *   MIGRATE_TABLES        逗号分隔的表名，覆盖默认集合
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config();

const root = path.resolve(__dirname, '..');

const DEFAULT_TABLES = [
  'users',
  'admin_roles',
  'system_configs',
  'devices',
  'device_time_slots',
  'reservation_batches',
  'reservation_items',
  'reservations',
  'borrow_records',
  'receive_records',
  'device_fault_reports',
  'user_requests',
  'user_notifications',
  'operation_logs',
  'export_jobs',
  'chat_conversations',
  'chat_participants',
  'chat_messages',
  'chat_message_reads'
];

function parseArgs(argv) {
  const args = { check: false, export: false, import: false };
  for (const a of argv.slice(2)) {
    if (a === '--check') args.check = true;
    else if (a === '--export') args.export = true;
    else if (a === '--import') args.import = true;
    else if (a.startsWith('--tables=')) args.tables = a.slice('--tables='.length).split(',').map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

function makePool(url, label) {
  if (!url) return null;
  return new Pool({
    connectionString: url,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });
}

async function countRows(pool, tables) {
  const out = {};
  for (const t of tables) {
    try {
      const r = await pool.query(`SELECT count(*)::int AS n FROM "${t}"`);
      out[t] = r.rows[0].n;
    } catch (e) {
      out[t] = `ERR: ${e.message}`;
    }
  }
  return out;
}

async function exportTable(pool, table, outDir) {
  const file = path.join(outDir, `${table}.json`);
  const r = await pool.query(`SELECT * FROM "${table}" ORDER BY created_at NULLS LAST, id`);
  fs.writeFileSync(file, JSON.stringify(r.rows, null, 2), 'utf8');
  return r.rowCount;
}

async function importTable(pool, table, outDir) {
  const file = path.join(outDir, `${table}.json`);
  if (!fs.existsSync(file)) return 0;
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return 0;

  const columns = Object.keys(rows[0]);
  const colList = columns.map((c) => `"${c}"`).join(', ');
  const paramList = columns.map((_, i) => `$${i + 1}`).join(', ');
  const conflict = `"id"`;
  const updateSet = columns.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
  const sql = `INSERT INTO "${table}" (${colList}) VALUES (${paramList}) ON CONFLICT (${conflict}) DO ${updateSet ? `UPDATE SET ${updateSet}` : 'NOTHING'}`;

  let inserted = 0;
  for (const row of rows) {
    const values = columns.map((c) => (row[c] === undefined ? null : row[c]));
    try {
      await pool.query(sql, values);
      inserted += 1;
    } catch (e) {
      console.warn(`  ${table} 跳过一行：${e.message}`);
    }
  }
  return inserted;
}

async function main() {
  const args = parseArgs(process.argv);
  const tables = (args.tables && args.tables.length ? args.tables : DEFAULT_TABLES);
  const sourceUrl = process.env.SOURCE_DATABASE_URL || '';
  const targetUrl = process.env.TARGET_DATABASE_URL || '';

  if (!sourceUrl) {
    throw new Error('SOURCE_DATABASE_URL is not configured (2.x source database).');
  }

  const src = makePool(sourceUrl, 'source');
  const tgt = makePool(targetUrl, 'target');
  const dryRun = process.env.MIGRATE_DRY_RUN === '1';
  const outDir = path.join(root, 'sql', 'seed', 'v3-export');
  if (args.export && !dryRun) fs.mkdirSync(outDir, { recursive: true });

  try {
    // --check: 连通 + 行数对照
    console.log('=== 2.x → 3.0 迁移工具 ===');
    console.log(`源库: ${maskUrl(sourceUrl)}`);
    console.log(`目标库: ${targetUrl ? maskUrl(targetUrl) : '(未配置，仅导出)'}`);
    console.log(`表清单: ${tables.join(', ')}`);
    console.log('');

    console.log('[1] 行数对照');
    const srcCounts = await countRows(src, tables);
    let tgtCounts = {};
    if (tgt) {
      tgtCounts = await countRows(tgt, tables);
    }
    for (const t of tables) {
      const s = srcCounts[t];
      const d = tgt ? (tgtCounts[t] ?? '-') : '-';
      const mark = typeof s === 'number' && typeof d === 'number' && s === d ? 'OK' : (tgt ? 'DIFF' : '');
      console.log(`  ${t.padEnd(28)} 源=${String(s).padEnd(8)} 目标=${String(d).padEnd(8)} ${mark}`);
    }
    console.log('');

    if (args.check && !args.export && !args.import) {
      console.log('check 完成。');
      return;
    }
    if (dryRun) {
      console.log('MIGRATE_DRY_RUN=1，跳过实际导出/导入。');
      return;
    }

    // --export
    if (args.export) {
      console.log('[2] 导出源库 → ' + path.relative(root, outDir));
      for (const t of tables) {
        try {
          const n = await exportTable(src, t, outDir);
          console.log(`  导出 ${t}: ${n} 行`);
        } catch (e) {
          console.warn(`  跳过 ${t}: ${e.message}`);
        }
      }
      console.log('');
    }

    // --import
    if (args.import) {
      if (!tgt) throw new Error('TARGET_DATABASE_URL is required for --import.');
      console.log('[3] 导入目标库 (upsert by id)');
      for (const t of tables) {
        try {
          const n = await importTable(tgt, t, outDir);
          console.log(`  导入 ${t}: ${n} 行`);
        } catch (e) {
          console.warn(`  跳过 ${t}: ${e.message}`);
        }
      }
      console.log('');
    }

    console.log('完成。');
  } finally {
    if (src) { await src.end(); }
    if (tgt) { await tgt.end(); }
  }
}

function maskUrl(url) {
  return url.replace(/:[^:@]+@/, ':***@');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

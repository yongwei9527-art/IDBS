#!/usr/bin/env node
/**
 * Delete orphan files under UPLOAD_DIR that are older than UPLOAD_ORPHAN_MAX_AGE_DAYS
 * and not referenced by common DB text/json columns (best-effort).
 * Dry-run by default; pass --apply to delete.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const apply = process.argv.includes('--apply');
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  const maxAgeDays = Number(process.env.UPLOAD_ORPHAN_MAX_AGE_DAYS || 30);
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  if (!fs.existsSync(uploadDir)) {
    console.log('upload dir missing:', uploadDir);
    return;
  }

  const files = fs.readdirSync(uploadDir).filter((name) => {
    const full = path.join(uploadDir, name);
    try {
      const st = fs.statSync(full);
      return st.isFile() && st.mtimeMs < cutoff && !name.startsWith('.');
    } catch (_) {
      return false;
    }
  });

  let referenced = new Set();
  const databaseUrl = process.env.DATABASE_URL || '';
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const tables = await pool.query(`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and data_type in ('text', 'character varying', 'json', 'jsonb')
      `);
      for (const row of tables.rows) {
        try {
          const q = await pool.query(
            `select ${row.column_name}::text as v from ${row.table_name} where ${row.column_name}::text like '%/uploads/%' limit 5000`
          );
          for (const r of q.rows) {
            const matches = String(r.v || '').match(/\/uploads\/([A-Za-z0-9._-]+)/g) || [];
            for (const m of matches) referenced.add(m.replace('/uploads/', ''));
          }
        } catch (_) {}
      }
    } finally {
      await pool.end().catch(() => {});
    }
  }

  const orphans = files.filter((name) => !referenced.has(name));
  console.log(JSON.stringify({
    uploadDir,
    maxAgeDays,
    candidates: files.length,
    referencedSample: [...referenced].slice(0, 5),
    orphans: orphans.length,
    apply,
    files: orphans.slice(0, 50)
  }, null, 2));

  if (apply) {
    let deleted = 0;
    for (const name of orphans) {
      try {
        fs.unlinkSync(path.join(uploadDir, name));
        deleted += 1;
      } catch (error) {
        console.warn('failed to delete', name, error.message);
      }
    }
    console.log('deleted', deleted);
  } else {
    console.log('dry-run only; re-run with --apply to delete');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

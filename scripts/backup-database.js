#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
require('dotenv').config({ quiet: true });

function parseArgs(argv) {
  const out = { verifyLatest: false, dir: '', keepDays: null, format: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--verify-latest') out.verifyLatest = true;
    else if (a === '--dir') out.dir = argv[++i] || '';
    else if (a === '--keep-days') out.keepDays = Number(argv[++i]);
    else if (a === '--format') out.format = String(argv[++i] || '');
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
}

function resolvePgDump(configured) {
  if (configured && fs.existsSync(configured)) return configured;
  if (process.platform !== 'win32') {
    const probe = spawnSync('which', ['pg_dump'], { encoding: 'utf8' });
    const line = String(probe.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (line && fs.existsSync(line)) return line;
  } else {
    const roots = ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL'];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      const versions = fs.readdirSync(root).sort().reverse();
      for (const v of versions) {
        const candidate = path.join(root, v, 'bin', 'pg_dump.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return 'pg_dump';
}

function parseDatabaseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    database: decodeURIComponent((u.pathname || '').replace(/^\//, ''))
  };
}

function listBackupFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^idbs-\d{8}T\d{6}Z\.(dump|sql)$/.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return { name, full, mtimeMs: st.mtimeMs, size: st.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneBackups(dir, keepDays) {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const files = listBackupFiles(dir);
  let removed = 0;
  for (const file of files) {
    if (file.mtimeMs >= cutoff) continue;
    fs.unlinkSync(file.full);
    const manifest = file.full + '.json';
    if (fs.existsSync(manifest)) fs.unlinkSync(manifest);
    removed += 1;
  }
  return { kept: listBackupFiles(dir).length, removed };
}

function verifyLatest(dir) {
  const files = listBackupFiles(dir);
  if (!files.length) {
    console.error('FAIL no backup files found in', dir);
    process.exit(2);
  }
  const latest = files[0];
  const manifestPath = latest.full + '.json';
  if (!fs.existsSync(manifestPath)) {
    console.error('FAIL missing manifest for', latest.name);
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const actual = sha256File(latest.full);
  if (manifest.sha256 !== actual) {
    console.error('FAIL checksum mismatch for', latest.name);
    process.exit(2);
  }
  if (Number(manifest.size) !== latest.size) {
    console.error('FAIL size mismatch for', latest.name);
    process.exit(2);
  }
  console.log('PASS verify', latest.name, 'sha256=' + actual.slice(0, 12) + '...', 'size=' + latest.size);
  console.log(' age_hours=' + ((Date.now() - latest.mtimeMs) / 3600000).toFixed(2));
  return 0;
}

function main() {
  const args = parseArgs(process.argv);
  const databaseUrl = process.env.DATABASE_URL || '';
  const backupDir = path.resolve(args.dir || process.env.BACKUP_DIR || path.join(process.cwd(), 'backups', 'db'));
  const keepDays = Number.isFinite(args.keepDays) ? args.keepDays : Number(process.env.BACKUP_RETENTION_DAYS || 14);
  const format = String(args.format || process.env.BACKUP_FORMAT || 'custom').toLowerCase() === 'plain' ? 'plain' : 'custom';

  ensureDir(backupDir);

  if (args.verifyLatest) {
    process.exit(verifyLatest(backupDir));
  }

  if (!databaseUrl) {
    console.error('FAIL DATABASE_URL is not configured.');
    process.exit(1);
  }

  let db;
  try {
    db = parseDatabaseUrl(databaseUrl);
  } catch (error) {
    console.error('FAIL invalid DATABASE_URL:', error.message || error);
    process.exit(1);
  }
  if (!db.database) {
    console.error('FAIL DATABASE_URL missing database name.');
    process.exit(1);
  }

  const ts = stamp();
  const ext = format === 'plain' ? 'sql' : 'dump';
  const outFile = path.join(backupDir, 'idbs-' + ts + '.' + ext);
  const pgDump = resolvePgDump(process.env.PG_DUMP_PATH || '');
  const env = Object.assign({}, process.env, { PGPASSWORD: db.password || process.env.PGPASSWORD || '' });
  const dumpArgs = [
    '-h', db.host,
    '-p', String(db.port),
    '-U', db.user,
    '-d', db.database,
    '--no-owner',
    '--no-acl',
    '-f', outFile
  ];
  if (format === 'custom') dumpArgs.push('-Fc');
  else dumpArgs.push('--encoding=UTF8');

  console.log('START backup');
  console.log(' dir=', backupDir);
  console.log(' format=', format);
  console.log(' database=', db.database);
  console.log(' host=', db.host + ':' + db.port);
  console.log(' pg_dump=', pgDump);
  console.log(' out=', outFile);

  const started = Date.now();
  const result = spawnSync(pgDump, dumpArgs, { env: env, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    if (fs.existsSync(outFile)) {
      try { fs.unlinkSync(outFile); } catch (_) {}
    }
    console.error('FAIL pg_dump failed');
    if (result.error) console.error(result.error.message || result.error);
    if (result.stderr) console.error(String(result.stderr).trim());
    if (result.stdout) console.error(String(result.stdout).trim());
    if (String((result.error && result.error.message) || result.stderr || '').includes('ENOENT')) {
      console.error('HINT: install PostgreSQL client tools and ensure pg_dump is on PATH, or set PG_DUMP_PATH.');
    }
    process.exit(1);
  }

  const size = fs.statSync(outFile).size;
  if (size < 64) {
    console.error('FAIL dump file too small:', size);
    process.exit(1);
  }
  const digest = sha256File(outFile);
  const meta = {
    created_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    database: db.database,
    host: db.host,
    port: Number(db.port),
    format: format,
    file: path.basename(outFile),
    size: size,
    sha256: digest,
    retention_days: keepDays,
    tool: 'pg_dump',
    app: 'idbs',
    version: '5.0'
  };
  const manifestPath = outFile + '.json';
  fs.writeFileSync(manifestPath, JSON.stringify(meta, null, 2), 'utf8');
  const prune = pruneBackups(backupDir, keepDays);

  console.log('PASS backup complete');
  console.log(' file=', outFile);
  console.log(' size=', size);
  console.log(' sha256=', digest);
  console.log(' manifest=', manifestPath);
  console.log(' retention_days=', keepDays, 'kept=', prune.kept, 'removed=', prune.removed);
  console.log(' duration_ms=', meta.duration_ms);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('FAIL', error.message || error);
    process.exit(1);
  }
}

module.exports = { listBackupFiles, pruneBackups, sha256File };
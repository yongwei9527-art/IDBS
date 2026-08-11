#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

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

function loadConfiguredEnvironment(env = process.env) {
  const configuredPath = String(env.ENV_FILE || '').trim();
  const options = {
    quiet: true,
    override: false,
    processEnv: env
  };
  if (configuredPath) options.path = path.resolve(configuredPath);
  dotenv.config(options);
  return configuredPath ? path.resolve(configuredPath) : path.resolve(process.cwd(), '.env');
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

function resolvePgTool(tool, configured, siblingToolPath = '') {
  if (configured) return configured;

  if (siblingToolPath) {
    const executable = process.platform === 'win32' ? `${tool}.exe` : tool;
    const candidate = path.join(path.dirname(siblingToolPath), executable);
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform !== 'win32') {
    const probe = spawnSync('which', [tool], { encoding: 'utf8' });
    const line = String(probe.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (line && fs.existsSync(line)) return line;
  } else {
    const roots = ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL'];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      const versions = fs.readdirSync(root).sort().reverse();
      for (const version of versions) {
        const candidate = path.join(root, version, 'bin', `${tool}.exe`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return tool;
}

function resolvePgDump(configured) {
  return resolvePgTool('pg_dump', configured);
}

function resolvePgRestore(configured, pgDumpPath = '') {
  return resolvePgTool('pg_restore', configured, pgDumpPath);
}

function envFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function rejectsUnauthorized(value) {
  return !['0', 'false', 'no', 'off'].includes(String(value === undefined ? 'true' : value).trim().toLowerCase());
}

function decodeUrlPart(value, label) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_) {
    throw new Error(`DATABASE_URL contains an invalid percent-encoded ${label}.`);
  }
}

function findSearchParamKey(searchParams, expectedName) {
  const expected = String(expectedName).toLowerCase();
  return Array.from(searchParams.keys()).find((key) => key.toLowerCase() === expected) || '';
}

function deleteSearchParam(searchParams, expectedName) {
  const expected = String(expectedName).toLowerCase();
  for (const key of Array.from(searchParams.keys())) {
    if (key.toLowerCase() === expected) searchParams.delete(key);
  }
}

function sanitizedToolEnvironment(env = process.env, options = {}) {
  const childEnv = {};
  const allowedKeys = new Set([
    'PATH', 'Path', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'WINDIR',
    'COMSPEC', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LANGUAGE',
    'TZ', 'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSFILE',
    'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGAPPNAME', 'PGSSLMODE',
    'PGREQUIRESSL', 'PGSSLCOMPRESSION', 'PGSSLCERT', 'PGSSLKEY', 'PGSSLROOTCERT',
    'PGSSLCRL', 'PGCHANNELBINDING', 'PGTARGETSESSIONATTRS', 'PGCONNECT_TIMEOUT',
    'PGCLIENTENCODING'
  ]);
  for (const [key, value] of Object.entries(env)) {
    if (allowedKeys.has(key) || key.startsWith('LC_')) childEnv[key] = value;
  }
  if (options.keepPgPassword && env.PGPASSWORD) childEnv.PGPASSWORD = env.PGPASSWORD;
  return childEnv;
}

function createTemporaryPgSslRootCert(caText) {
  const normalized = String(caText || '').replace(/\\n/g, '\n').trim();
  if (!normalized) return { filePath: '', cleanup() {} };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laboratory-pgssl-'));
  const filePath = path.join(tempDir, 'root-ca.pem');
  try {
    fs.chmodSync(tempDir, 0o700);
    fs.writeFileSync(filePath, `${normalized}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    filePath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function prepareDatabaseConnection(databaseUrl, env = process.env) {
  let parsed;
  try {
    parsed = new URL(String(databaseUrl || '').trim());
  } catch (error) {
    throw new Error(`invalid DATABASE_URL: ${error.message || error}`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }

  const queryPasswordKey = findSearchParamKey(parsed.searchParams, 'password');
  const password = parsed.password
    ? decodeUrlPart(parsed.password, 'password')
    : (queryPasswordKey ? String(parsed.searchParams.get(queryPasswordKey) || '') : '');
  parsed.password = '';
  deleteSearchParam(parsed.searchParams, 'password');

  if (envFlagEnabled(env.PGSSL) && !findSearchParamKey(parsed.searchParams, 'sslmode')) {
    parsed.searchParams.set('sslmode', rejectsUnauthorized(env.PGSSL_REJECT_UNAUTHORIZED) ? 'verify-full' : 'require');
  }

  const databasePath = String(parsed.pathname || '').replace(/^\//, '');
  const dbNameKey = findSearchParamKey(parsed.searchParams, 'dbname');
  const database = databasePath
    ? decodeUrlPart(databasePath, 'database name')
    : (dbNameKey ? String(parsed.searchParams.get(dbNameKey) || '') : '');
  if (!database) throw new Error('DATABASE_URL missing database name.');

  const userKey = findSearchParamKey(parsed.searchParams, 'user');
  const hostKey = findSearchParamKey(parsed.searchParams, 'host');
  const portKey = findSearchParamKey(parsed.searchParams, 'port');
  const childEnv = sanitizedToolEnvironment(env, { keepPgPassword: true });
  if (password) childEnv.PGPASSWORD = password;

  let caFile = { filePath: '', cleanup() {} };
  const caText = String(env.PGSSL_CA || '').replace(/\\n/g, '\n').trim();
  if (caText && !findSearchParamKey(parsed.searchParams, 'sslrootcert')) {
    caFile = createTemporaryPgSslRootCert(caText);
    childEnv.PGSSLROOTCERT = caFile.filePath;
  }

  return {
    connectionString: parsed.toString(),
    database,
    host: parsed.hostname || (hostKey ? String(parsed.searchParams.get(hostKey) || '') : ''),
    port: parsed.port || (portKey ? String(parsed.searchParams.get(portKey) || '') : '') || '5432',
    user: parsed.username
      ? decodeUrlPart(parsed.username, 'username')
      : (userKey ? String(parsed.searchParams.get(userKey) || '') : ''),
    password,
    env: childEnv,
    sslRootCertFile: caFile.filePath,
    cleanup: caFile.cleanup
  };
}

function listBackupFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^laboratory-management-system-\d{8}T\d{6}Z\.(dump|sql)$/.test(name))
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

function pgToolFailure(tool, result, action) {
  const details = [result?.error?.message, result?.stderr, result?.stdout]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
  const error = new Error(`${action} failed with ${tool}${details ? `:\n${details}` : '.'}`);
  if (String(result?.error?.code || '').toUpperCase() === 'ENOENT' || /ENOENT/i.test(details)) {
    error.hint = `Install PostgreSQL client tools and ensure ${path.basename(tool)} is on PATH, or configure its explicit path.`;
  }
  return error;
}

function verifyCustomDump(dumpPath, options = {}) {
  const pgRestore = options.pgRestore || resolvePgRestore(options.pgRestorePath || '', options.pgDumpPath || '');
  const run = options.spawnSync || spawnSync;
  const result = run(pgRestore, ['--list', dumpPath], {
    env: options.env || sanitizedToolEnvironment(process.env),
    encoding: 'utf8',
    windowsHide: true
  });
  if (result?.error || result?.status !== 0) {
    throw pgToolFailure(pgRestore, result, 'pg_restore --list verification');
  }
  return { pgRestore, verified: true };
}

function verificationFailure(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function verifyLatest(dir, options = {}) {
  const files = listBackupFiles(dir);
  if (!files.length) throw verificationFailure(`no backup files found in ${dir}`);

  const latest = files[0];
  const manifestPath = latest.full + '.json';
  if (!fs.existsSync(manifestPath)) throw verificationFailure(`missing manifest for ${latest.name}`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw verificationFailure(`invalid manifest for ${latest.name}: ${error.message || error}`);
  }

  const actual = sha256File(latest.full);
  if (manifest.sha256 !== actual) throw verificationFailure(`checksum mismatch for ${latest.name}`);
  if (Number(manifest.size) !== latest.size) throw verificationFailure(`size mismatch for ${latest.name}`);

  let restoreListVerified = false;
  if (path.extname(latest.name).toLowerCase() === '.dump') {
    try {
      verifyCustomDump(latest.full, {
        pgRestore: options.pgRestore,
        pgRestorePath: options.pgRestorePath || process.env.PG_RESTORE_PATH || '',
        spawnSync: options.spawnSync,
        env: options.env || sanitizedToolEnvironment(process.env)
      });
      restoreListVerified = true;
    } catch (error) {
      error.exitCode = 2;
      throw error;
    }
  }

  console.log('PASS verify', latest.name, 'sha256=' + actual.slice(0, 12) + '...', 'size=' + latest.size);
  if (restoreListVerified) console.log(' restore_list=verified');
  console.log(' age_hours=' + ((Date.now() - latest.mtimeMs) / 3600000).toFixed(2));
  return 0;
}

function removeIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

function main() {
  try { process.umask(0o077); } catch (_) {}
  loadConfiguredEnvironment(process.env);

  const args = parseArgs(process.argv);
  const databaseUrl = process.env.DATABASE_URL || '';
  const backupDir = path.resolve(args.dir || process.env.BACKUP_DIR || path.join(process.cwd(), 'backups', 'db'));
  const keepDays = Number.isFinite(args.keepDays) ? args.keepDays : Number(process.env.BACKUP_RETENTION_DAYS || 14);
  const format = String(args.format || process.env.BACKUP_FORMAT || 'custom').toLowerCase() === 'plain' ? 'plain' : 'custom';

  if (!Number.isInteger(keepDays) || keepDays < 1 || keepDays > 3650) {
    throw new Error('BACKUP_RETENTION_DAYS must be a whole number from 1 to 3650.');
  }

  ensureDir(backupDir);

  if (args.verifyLatest) {
    verifyLatest(backupDir, { pgRestorePath: process.env.PG_RESTORE_PATH || '' });
    return;
  }

  if (!databaseUrl) throw new Error('DATABASE_URL is not configured.');

  const db = prepareDatabaseConnection(databaseUrl, process.env);
  const ts = stamp();
  const ext = format === 'plain' ? 'sql' : 'dump';
  const outFile = path.join(backupDir, 'laboratory-management-system-' + ts + '.' + ext);
  const manifestPath = outFile + '.json';
  const pgDump = resolvePgDump(process.env.PG_DUMP_PATH || '');
  const pgRestore = format === 'custom'
    ? resolvePgRestore(process.env.PG_RESTORE_PATH || '', pgDump)
    : '';
  const dumpArgs = [
    '--dbname', db.connectionString,
    '--no-owner',
    '--no-acl',
    '--file', outFile
  ];
  if (format === 'custom') dumpArgs.push('--format=custom');
  else dumpArgs.push('--format=plain', '--encoding=UTF8');

  console.log('START backup');
  console.log(' dir=', backupDir);
  console.log(' format=', format);
  console.log(' database=', db.database);
  console.log(' host=', db.host ? db.host + ':' + db.port : 'libpq-default');
  console.log(' pg_dump=', pgDump);
  if (pgRestore) console.log(' pg_restore=', pgRestore);
  console.log(' out=', outFile);

  const started = Date.now();
  let backupComplete = false;
  try {
    const result = spawnSync(pgDump, dumpArgs, { env: db.env, encoding: 'utf8', windowsHide: true });
    if (result?.error || result?.status !== 0) {
      const error = pgToolFailure(pgDump, result, 'pg_dump backup');
      if (error.hint) console.error('HINT:', error.hint);
      throw error;
    }

    const size = fs.statSync(outFile).size;
    if (size < 64) throw new Error(`dump file too small: ${size}`);

    let restoreListVerified = false;
    if (format === 'custom') {
      try {
        verifyCustomDump(outFile, { pgRestore, pgDumpPath: pgDump, env: sanitizedToolEnvironment(process.env) });
        restoreListVerified = true;
      } catch (error) {
        if (error.hint) console.error('HINT:', error.hint);
        throw error;
      }
    }

    const digest = sha256File(outFile);
    const numericPort = Number(db.port);
    const meta = {
      created_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      database: db.database,
      host: db.host,
      port: Number.isFinite(numericPort) ? numericPort : db.port,
      format,
      file: path.basename(outFile),
      size,
      sha256: digest,
      restore_list_verified: restoreListVerified,
      retention_days: keepDays,
      tool: path.basename(pgDump),
      app: 'laboratory_management_system',
      version: '5.0'
    };
    fs.writeFileSync(manifestPath, JSON.stringify(meta, null, 2), { encoding: 'utf8', mode: 0o600 });
    backupComplete = true;

    const prune = pruneBackups(backupDir, keepDays);
    console.log('PASS backup complete');
    console.log(' file=', outFile);
    console.log(' size=', size);
    console.log(' sha256=', digest);
    console.log(' restore_list_verified=', restoreListVerified);
    console.log(' manifest=', manifestPath);
    console.log(' retention_days=', keepDays, 'kept=', prune.kept, 'removed=', prune.removed);
    console.log(' duration_ms=', meta.duration_ms);
  } catch (error) {
    if (!backupComplete) {
      removeIfExists(outFile);
      removeIfExists(manifestPath);
    }
    throw error;
  } finally {
    db.cleanup();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('FAIL', error.message || error);
    process.exitCode = Number(error.exitCode || 1);
  }
}

module.exports = {
  createTemporaryPgSslRootCert,
  listBackupFiles,
  loadConfiguredEnvironment,
  prepareDatabaseConnection,
  pruneBackups,
  resolvePgDump,
  resolvePgRestore,
  sanitizedToolEnvironment,
  sha256File,
  verifyCustomDump,
  verifyLatest
};

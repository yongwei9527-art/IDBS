const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadConfiguredEnvironment,
  prepareDatabaseConnection,
  sanitizedToolEnvironment,
  sha256File,
  verifyCustomDump,
  verifyLatest
} = require('../../scripts/backup-database');

const root = path.resolve(__dirname, '..', '..');
const backupScriptPath = path.join(root, 'scripts', 'backup.sh');
const backupNodePath = path.join(root, 'scripts', 'backup-database.js');

function temporaryDirectory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-backup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('backup loader honors ENV_FILE without overriding already supplied environment values', (t) => {
  const dir = temporaryDirectory(t);
  const envFile = path.join(dir, 'installed.env');
  fs.writeFileSync(envFile, [
    'DATABASE_URL=postgresql://file_user:file_password@db.example.com/file_database',
    'BACKUP_RETENTION_DAYS=21',
    'PGSSL=true'
  ].join('\n'));

  const env = {
    ENV_FILE: envFile,
    DATABASE_URL: 'postgresql://runtime_user:runtime_password@db.example.com/runtime_database'
  };
  const loadedPath = loadConfiguredEnvironment(env);

  assert.equal(loadedPath, path.resolve(envFile));
  assert.equal(env.DATABASE_URL, 'postgresql://runtime_user:runtime_password@db.example.com/runtime_database');
  assert.equal(env.BACKUP_RETENTION_DAYS, '21');
  assert.equal(env.PGSSL, 'true');
});

test('database connection keeps libpq and SSL options while removing passwords from argv-safe URI', () => {
  const databaseUrl = 'postgresql://runtime:p%40ss@db.example.com:6543/lab?sslmode=verify-full&sslrootcert=%2Fcerts%2Fca.pem&options=-c%20statement_timeout%3D5000';
  const connection = prepareDatabaseConnection(databaseUrl, {
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: 'postgresql://owner:owner-secret@db.example.com/lab',
    PGSSL: 'true',
    PGSSL_REJECT_UNAUTHORIZED: 'true',
    PGSSL_CA: 'unused because sslrootcert is explicit'
  });

  try {
    const parsed = new URL(connection.connectionString);
    assert.equal(connection.password, 'p@ss');
    assert.equal(connection.database, 'lab');
    assert.equal(connection.host, 'db.example.com');
    assert.equal(connection.port, '6543');
    assert.equal(parsed.password, '');
    assert.equal(parsed.searchParams.get('sslmode'), 'verify-full');
    assert.equal(parsed.searchParams.get('sslrootcert'), '/certs/ca.pem');
    assert.equal(parsed.searchParams.get('options'), '-c statement_timeout=5000');
    assert.doesNotMatch(connection.connectionString, /p%40ss|p@ss|owner-secret/);
    assert.equal(connection.env.PGPASSWORD, 'p@ss');
    assert.equal(connection.env.DATABASE_URL, undefined);
    assert.equal(connection.env.MIGRATION_DATABASE_URL, undefined);
    assert.equal(connection.env.PGSSL_CA, undefined);
    assert.equal(connection.sslRootCertFile, '');
  } finally {
    connection.cleanup();
  }
});

test('PGSSL_CA is materialized as a private temporary root certificate and cleaned up', () => {
  const connection = prepareDatabaseConnection('postgresql://runtime:secret@db.example.com/lab?options=-c%20lock_timeout%3D5000', {
    PGSSL: 'true',
    PGSSL_REJECT_UNAUTHORIZED: 'true',
    PGSSL_CA: '-----BEGIN CERTIFICATE-----\\nTEST\\n-----END CERTIFICATE-----'
  });
  const caPath = connection.sslRootCertFile;

  assert.ok(caPath);
  assert.equal(connection.env.PGSSLROOTCERT, caPath);
  assert.equal(new URL(connection.connectionString).searchParams.get('sslmode'), 'verify-full');
  assert.match(fs.readFileSync(caPath, 'utf8'), /BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE/);
  connection.cleanup();
  assert.equal(fs.existsSync(caPath), false);
});

test('custom backups are validated with pg_restore --list and no database secret environment', (t) => {
  const dir = temporaryDirectory(t);
  const dumpPath = path.join(dir, 'test.dump');
  fs.writeFileSync(dumpPath, Buffer.alloc(128, 7));
  const calls = [];

  verifyCustomDump(dumpPath, {
    pgRestore: 'pg_restore-test',
    env: sanitizedToolEnvironment({ DATABASE_URL: 'postgresql://u:secret@db/lab', SAFE: '1' }),
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'archive list', stderr: '' };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'pg_restore-test');
  assert.deepEqual(calls[0].args, ['--list', dumpPath]);
  assert.equal(calls[0].options.env.DATABASE_URL, undefined);
  assert.equal(calls[0].options.env.SAFE, '1');
});

test('verify-latest re-runs pg_restore --list for a custom dump after checksum validation', (t) => {
  const dir = temporaryDirectory(t);
  const dumpName = 'laboratory-management-system-20260810T000000Z.dump';
  const dumpPath = path.join(dir, dumpName);
  fs.writeFileSync(dumpPath, Buffer.alloc(128, 9));
  fs.writeFileSync(`${dumpPath}.json`, JSON.stringify({
    file: dumpName,
    size: fs.statSync(dumpPath).size,
    sha256: sha256File(dumpPath)
  }));
  const calls = [];

  assert.equal(verifyLatest(dir, {
    pgRestore: 'pg_restore-test',
    env: {},
    spawnSync(command, args) {
      calls.push({ command, args });
      return { status: 0, stdout: 'archive list', stderr: '' };
    }
  }), 0);
  assert.deepEqual(calls, [{ command: 'pg_restore-test', args: ['--list', dumpPath] }]);
});

test('manual backup wrapper passes ENV_FILE to Node without placing DATABASE_URL in process arguments', () => {
  const shellSource = fs.readFileSync(backupScriptPath, 'utf8');
  const nodeSource = fs.readFileSync(backupNodePath, 'utf8');

  assert.match(shellSource, /ENV_FILE="\$ENV_FILE" BACKUP_DIR="\$BACKUP_DIR\/db" node "\$APP_CURRENT\/scripts\/backup-database\.js" --verify-latest/);
  assert.match(shellSource, /ENV_FILE="\$ENV_FILE" BACKUP_DIR="\$database_backup_dir" \\\n\s*node "\$APP_CURRENT\/scripts\/backup-database\.js" --dir "\$database_backup_dir" --keep-days "\$retention"/);
  assert.doesNotMatch(shellSource, /(?:node|backup-database\.js)[^\n]*DATABASE_URL/);
  assert.doesNotMatch(shellSource, /(?:source|\.)\s+"\$ENV_FILE"/);
  assert.match(shellSource, /find "\$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type f \\\n\s*\\\( -name 'uploads-\*\.tar\.gz' -o -name 'exports-\*\.tar\.gz' \\\) \\\n\s*-mtime \+"\$retention" -delete/);
  assert.doesNotMatch(shellSource, /find "\$BACKUP_DIR"[^\n]*-maxdepth 2[^\n]*-delete/);
  assert.match(nodeSource, /'--dbname', db\.connectionString/);
  assert.doesNotMatch(nodeSource, /'-h', db\.host|'-U', db\.user|'-d', db\.database/);
});

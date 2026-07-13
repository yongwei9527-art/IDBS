const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config({ quiet: true });

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'sql', 'migrations');
const connectionString = process.env.DATABASE_URL || '';

function isForwardMigrationFile(file) {
  return String(file || '').toLowerCase().endsWith('.sql')
    && !/(?:^|[._-])rollback(?:[._-]|$)/i.test(String(file || ''));
}

function discoverMigrationFiles(directory) {
  return fs.readdirSync(directory)
    .filter(isForwardMigrationFile)
    .sort();
}

async function main() {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured.');
  }

  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found.');
    return;
  }

  const files = discoverMigrationFiles(migrationsDir);

  if (!files.length) {
    console.log('No migration files found.');
    return;
  }

  const pool = new Pool({
    connectionString,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });

  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    for (const file of files) {
      const version = path.basename(file, '.sql');
      const applied = await client.query('select 1 from schema_migrations where version = $1', [version]);
      if (applied.rowCount) {
        console.log(`SKIP ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').replace(/^\uFEFF/, '');
      console.log(`APPLY ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1) on conflict do nothing', [version]);
        await client.query('commit');
        console.log(`DONE ${file}`);
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { discoverMigrationFiles, isForwardMigrationFile };

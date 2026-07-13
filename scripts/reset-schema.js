const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config();

const root = path.resolve(__dirname, '..');
const schemaPath = path.join(root, 'sql', 'schema.sql');
const connectionString = process.env.DATABASE_URL || '';
const confirmReset = process.env.RESET_IDBS_SCHEMA === '1';
const allowProductionReset = process.env.ALLOW_PRODUCTION_SCHEMA_RESET === '1';

function looksLikeProductionDatabase(url) {
  return !/(localhost|127\.0\.0\.1|::1)/i.test(url);
}

async function main() {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured.');
  }
  if (!confirmReset) {
    throw new Error('Refusing to reset schema. Set RESET_IDBS_SCHEMA=1 after backing up the database.');
  }
  if (looksLikeProductionDatabase(connectionString) && !allowProductionReset) {
    throw new Error('Refusing to reset a non-local database. Set ALLOW_PRODUCTION_SCHEMA_RESET=1 only after a verified backup.');
  }
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf8').replace(/^\uFEFF/, '');
  const pool = new Pool({
    connectionString,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });

  const client = await pool.connect();
  try {
    console.log('Dropping public schema...');
    await client.query('drop schema if exists public cascade');
    await client.query('create schema public');
    await client.query('grant usage on schema public to public');
    await client.query('grant create on schema public to public');

    console.log('Applying sql/schema.sql as the fresh IDBS baseline...');
    await client.query(schemaSql);
    console.log('Fresh schema baseline is ready.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});


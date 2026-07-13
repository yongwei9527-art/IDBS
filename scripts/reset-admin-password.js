const crypto = require('crypto');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');

const fs = require('fs');
const path = require('path');

const localEnvPath = path.resolve(process.cwd(), '.env');
const vpsSharedEnvPath = '/var/www/idbs/shared/.env';
require('dotenv').config({
  path: fs.existsSync(localEnvPath) ? localEnvPath : vpsSharedEnvPath
});

const connectionString = process.env.DATABASE_URL || '';
const newPassword = process.env.ADMIN_NEW_PASSWORD || process.argv[2] || '';

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  }).toString('hex');
}

async function upsertConfig(client, key, value, description) {
  await client.query(`
    insert into system_configs (id, config_key, config_value, description, created_at, updated_at)
    values (gen_random_uuid(), $1, $2, $3, now(), now())
    on conflict (config_key)
    do update set config_value = excluded.config_value,
      description = excluded.description,
      updated_at = excluded.updated_at
  `, [key, value, description]);
}

async function main() {
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  if (!newPassword || newPassword.length < 12) {
    throw new Error([
      'Usage:',
      '  ADMIN_NEW_PASSWORD=<at-least-12-chars> npm run admin:reset-password',
      '  npm run admin:reset-password -- <at-least-12-chars>',
      '  idbs-reset-admin-password  # on VPS after deployment'
    ].join('\n'));
  }

  const pool = new Pool({
    connectionString,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });

  try {
    const client = await pool.connect();
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      await client.query('begin');
      await upsertConfig(client, 'admin_password_salt', salt, 'Admin password salt');
      await upsertConfig(client, 'admin_password_hash', hashPassword(newPassword, salt), 'Admin password hash');
      await client.query('commit');
      console.log('Admin console password has been reset.');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

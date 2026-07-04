const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || '';
const newPassword = process.env.ADMIN_NEW_PASSWORD || process.argv[2] || '';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashPassword(password, salt) {
  return sha256(`${salt}:${password}`);
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
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Usage: ADMIN_NEW_PASSWORD=<at-least-8-chars> npm run admin:reset-password');
  }

  const pool = new Pool({
    connectionString,
    ssl: String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');

const localEnvPath = path.resolve(process.cwd(), '.env');
const vpsSharedEnvPath = process.env.ENV_FILE
  || path.resolve(process.env.APP_BASE || '/var/www/laboratory-management-system', 'shared/.env');
require('dotenv').config({
  path: fs.existsSync(localEnvPath) ? localEnvPath : vpsSharedEnvPath,
  quiet: true
});

function validateCredentials(input = {}) {
  const phone = String(input.phone || '').trim();
  const password = String(input.password || '');
  const name = String(input.name || '系统管理员').trim() || '系统管理员';

  if (!/^\+?[0-9-]{6,20}$/.test(phone)) {
    throw new Error('SUPER_ADMIN_PHONE must contain 6-20 digits, with optional + or hyphens.');
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error('SUPER_ADMIN_PASSWORD must contain 12-128 characters.');
  }
  if (name.length > 50) {
    throw new Error('SUPER_ADMIN_NAME must not exceed 50 characters.');
  }
  return { phone, password, name };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  }).toString('hex');
}

async function provisionSuperAdmin(client, input = {}) {
  const credentials = validateCredentials(input);
  const allowTransfer = input.allowTransfer === true;
  const current = (await client.query(`
    select u.id, u.phone
    from users u
    left join admin_roles ar on ar.user_id = u.id
    where u.role = 'super_admin' or ar.role_key = 'super_admin' or ar.permissions ? '*'
    order by case when u.role = 'super_admin' then 0 else 1 end, u.created_at asc
    limit 1
  `)).rows[0] || null;

  if (current && current.phone !== credentials.phone && !allowTransfer) {
    throw new Error(
      `A highest administrator already exists (${current.phone}). `
      + 'Set SUPER_ADMIN_FORCE_TRANSFER=1 only when an intentional ownership transfer is required.'
    );
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(credentials.password, salt);

  await client.query('begin');
  try {
    if (current && current.phone !== credentials.phone) {
      await client.query(`
        update admin_roles
        set role_key = 'admin', permissions = '[]'::jsonb,
          note = 'Highest administrator ownership transferred by VPS provisioning',
          updated_at = now()
        where user_id = $1
      `, [current.id]);
      await client.query(`
        update users set role = 'admin', updated_at = now()
        where id = $1 and role = 'super_admin'
      `, [current.id]);
    }

    const user = (await client.query(`
      insert into users (
        name, phone, student_no, group_name, password_hash, password_salt,
        password_reset_required, role, status, is_banned, approved_at, created_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, true, 'super_admin', 'active', false, now(), now(), now())
      on conflict (phone) do update set
        name = excluded.name,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        password_reset_required = true,
        temporary_password_expires_at = null,
        role = 'super_admin',
        status = 'active',
        is_banned = false,
        disabled_reason = null,
        deleted_at = null,
        approved_at = coalesce(users.approved_at, now()),
        updated_at = now()
      returning id, phone, name
    `, [
      credentials.name,
      credentials.phone,
      `ROOT-${credentials.phone}`.slice(0, 50),
      '系统管理',
      passwordHash,
      salt
    ])).rows[0];

    await client.query(`
      insert into admin_roles (user_id, role_key, permissions, note, created_at, updated_at)
      values ($1, 'super_admin', '["*"]'::jsonb, 'VPS installation highest administrator', now(), now())
      on conflict (user_id) do update set
        role_key = 'super_admin',
        permissions = '["*"]'::jsonb,
        note = excluded.note,
        updated_at = now()
    `, [user.id]);

    await client.query('commit');
    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      transferred: Boolean(current && current.phone !== user.phone),
      password_reset_required: true
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL || '';
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');

  const input = {
    phone: process.env.SUPER_ADMIN_PHONE,
    password: process.env.SUPER_ADMIN_PASSWORD,
    name: process.env.SUPER_ADMIN_NAME,
    allowTransfer: process.env.SUPER_ADMIN_FORCE_TRANSFER === '1'
  };
  validateCredentials(input);

  const pool = new Pool({
    connectionString,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });
  try {
    const client = await pool.connect();
    try {
      const result = await provisionSuperAdmin(client, input);
      console.log(`Highest administrator is ready: ${result.phone} (${result.name}).`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { hashPassword, provisionSuperAdmin, validateCredentials };

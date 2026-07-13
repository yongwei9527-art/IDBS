const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config({ quiet: true });

const connectionString = process.env.DATABASE_URL || '';
const appUser = process.env.IDBS_APP_DB_USER || process.env.APP_DB_USER || 'idbs_user';

function quoteIdent(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

async function main() {
  if (!connectionString) throw new Error('DATABASE_URL 未配置。');
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(appUser)) {
    throw new Error('应用数据库用户名不合法，请检查 IDBS_APP_DB_USER。');
  }

  const pool = new Pool({
    connectionString,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });

  const owner = quoteIdent(appUser);
  const client = await pool.connect();
  try {
    const role = await client.query('select 1 from pg_roles where rolname = $1 limit 1', [appUser]);
    if (!role.rowCount) throw new Error(`数据库角色不存在：${appUser}`);

    await client.query(`alter schema public owner to ${owner}`);
    await client.query(`
      do $idbs_owner$
      DECLARE
        r record;
      BEGIN
        FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE format('ALTER TABLE %I.%I OWNER TO ${owner}', r.schemaname, r.tablename);
        END LOOP;
        FOR r IN SELECT schemaname, viewname FROM pg_views WHERE schemaname = 'public' LOOP
          EXECUTE format('ALTER VIEW %I.%I OWNER TO ${owner}', r.schemaname, r.viewname);
        END LOOP;
        FOR r IN SELECT schemaname, matviewname FROM pg_matviews WHERE schemaname = 'public' LOOP
          EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO ${owner}', r.schemaname, r.matviewname);
        END LOOP;
        FOR r IN SELECT sequence_schema, sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' LOOP
          EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO ${owner}', r.sequence_schema, r.sequence_name);
        END LOOP;
        FOR r IN
          SELECT n.nspname AS schema_name, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS args
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
        LOOP
          EXECUTE format('ALTER FUNCTION %I.%I(%s) OWNER TO ${owner}', r.schema_name, r.function_name, r.args);
        END LOOP;
      END $idbs_owner$;
    `);
    await client.query(`grant usage, create on schema public to ${owner}`);
    await client.query(`grant all privileges on all tables in schema public to ${owner}`);
    await client.query(`grant all privileges on all sequences in schema public to ${owner}`);
    await client.query(`alter default privileges in schema public grant all on tables to ${owner}`);
    await client.query(`alter default privileges in schema public grant all on sequences to ${owner}`);
    console.log(`已将 public schema 对象属主与权限修复为：${appUser}`);
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  const message = String(error.message || error);
  if (/could not load .*pg_hba\.conf/i.test(message)) {
    console.error('PostgreSQL 无法读取 pg_hba.conf。请使用管理员 PowerShell 运行修复脚本，并确认 PostgreSQL 服务账号拥有该配置文件读取权限。');
  } else if (/password authentication failed/i.test(message)) {
    console.error('数据库登录失败：账号或密码不正确，请检查 DATABASE_URL 或本机 PostgreSQL 认证配置。');
  } else if (/ECONNREFUSED|connect ECONNREFUSED/i.test(message)) {
    console.error('无法连接 PostgreSQL：请确认 PostgreSQL 服务已启动，端口 5432 可访问。');
  } else {
    console.error(message);
  }
  process.exit(1);
});

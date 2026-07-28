const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config({ quiet: true });

const REQUIRED_COLUMNS = [
  'major',
  'mentor_name',
  'password_reset_required',
  'temporary_password_expires_at'
];

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: postgresSslOptions(),
    connectionTimeoutMillis: 5000
  });
  try {
    const result = await pool.query(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'users'
        and column_name = any($1)
      order by column_name
    `, [REQUIRED_COLUMNS]);
    if (result.rows.length !== REQUIRED_COLUMNS.length) {
      throw new Error(`Required authentication schema is incomplete (${result.rows.length}/${REQUIRED_COLUMNS.length}).`);
    }
    console.log(JSON.stringify(result.rows));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

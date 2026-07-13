const { Pool } = require('pg');
const { postgresSslOptions } = require('../src/lib/postgres-ssl');
require('dotenv').config({ quiet: true });

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: postgresSslOptions() });
  try {
    const counts = await pool.query(`
      select 'users' as entity, count(*)::int as count from users
      union all select 'admin_roles', count(*)::int from admin_roles
      union all select 'devices', count(*)::int from devices
      union all select 'reservation_items', count(*)::int from reservation_items
      union all select 'reservations', count(*)::int from reservations
      union all select 'borrow_records', count(*)::int from borrow_records
      union all select 'device_fault_reports', count(*)::int from device_fault_reports
      union all select 'operation_logs', count(*)::int from operation_logs
      union all select 'user_notifications', count(*)::int from user_notifications
      order by entity
    `);
    const roles = await pool.query(`
      select role_key, jsonb_array_length(permissions) as permission_count
      from admin_roles
      order by role_key
    `);
    console.table(counts.rows);
    console.table(roles.rows);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});


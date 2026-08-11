const { migrateDatabase } = require('./migrate-db');

/*
 * The forward migrations are the only writable upgrade source of truth.
 * migrateDatabase provides:
 * - a PostgreSQL session advisory lock plus an advisory xact lock;
 * - one transaction per forward migration and one transaction for final catalog validation;
 * - fail-fast checksum validation and no permission-error suppression;
 * - a single-transaction schema.sql baseline only when public has no application tables.
 *
 * All current operations are ordinary transactional DDL/DML. If a future migration needs
 * CREATE INDEX CONCURRENTLY or another command that PostgreSQL forbids in a transaction,
 * it must use a separately reviewed online-migration phase instead of weakening this runner.
 *
 * Legacy upgrade coverage retained by the forward chain includes:
 * refresh_token_sessions, scheduled_job_runs, rate_limit_buckets,
 * idx_refresh_token_sessions_expiry, idx_scheduled_job_runs_name_time,
 * idx_rate_limit_buckets_expiry, idx_reservation_items_pending_time,
 * idx_borrow_records_active_due, idx_users_pending_active,
 * device_maintenance_plans, device_maintenance_windows, device_maintenance_work_orders,
 * idx_maintenance_windows_lifecycle, idx_export_jobs_worker_queue,
 * idx_export_jobs_expired_files, attempt_count, max_attempts, available_at,
 * worker_id, lease_token, lease_expires_at, schema_v5_applied_at,
 * remove deprecated admin password seed, password_reset_requests,
 * legacy_import_runs, calendar_events_view and device_usage_summary_view.
 */

async function main() {
  await migrateDatabase({ baselineIfEmpty: true });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { main };

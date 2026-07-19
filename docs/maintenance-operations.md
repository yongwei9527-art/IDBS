# Maintenance Operations Runbook

## Purpose

This runbook describes the preventive-maintenance workflow in IDBS 5.0. Maintenance windows reserve a device time range and block new overlapping reservations. They are operational controls, not a billing feature.

## Workflow

1. Create an active maintenance plan for a device when recurring work is needed.
2. Create a work order with a valid time window. A linked plan and fault report must belong to the same device. The assignee must be an active, unbanned user.
3. Existing overlapping reservation holders receive an in-app notification. New overlapping reservations are rejected.
4. At the window start time, the lifecycle scheduler activates the window, sets the device status to `maintenance`, and disables reservations.
5. An administrator or operations user starts, completes, or cancels the work order. Terminal work orders cannot be reopened.
6. When a window passes its end time while its work order remains open, a single reminder is sent to the assignee and creator. The scheduler does not close work automatically.
7. Restore the device only after an explicit completion/cancellation operation with `restore_available=true`. Recovery is blocked while another open maintenance window, pending/in-progress work order, or pending/processing fault exists.
8. Fault resolution also uses the same device-level lock. A resolved fault cannot reopen a device while an active maintenance window or unfinished maintenance work order still exists.

## Scheduler and reliability

The runtime starts the maintenance lifecycle scheduler with a one-minute default interval. Each minute is claimed through `scheduled_job_runs`, so multiple application instances do not process the same lifecycle run. Device-level PostgreSQL transaction advisory locks serialize changes to each device schedule.

Monitor failed `maintenance-window-lifecycle` records in `scheduled_job_runs`, overdue work orders, and the maintenance overview API. Correct the underlying data or service issue before retrying; a later scheduler tick will claim a new minute.

## Deployment checks

- Apply `2026-07-12_device_maintenance.sql` and `2026-07-12_maintenance_lifecycle_index.sql` through the forward migration process.
- Run `npm run db:upgrade-schema` and `npm run doctor` to verify maintenance tables and indexes.
- Verify the scheduler is active after application startup and stops during graceful shutdown.
- Test with an isolated device: create a future work order, attempt an overlapping reservation, then advance a test clock or use a safe test window to verify activation.

## Incident guidance

Do not force a device to available merely because a maintenance window ended. Inspect open work orders, active/scheduled maintenance windows, and fault reports first. Preserve operation logs and in-app notifications for audit before changing records.

## Export job operations

Export CSV files are private operational records. They are never served from the public `/uploads/exports` path; administrators download them through the authenticated export-job endpoint. A job is claimed with `FOR UPDATE SKIP LOCKED` and a 15-minute lease, so multiple workers cannot publish the same result. Expired running leases can be reclaimed safely. Failed jobs use exponential retry backoff (30 seconds through 15 minutes) and stop after the configured maximum of three attempts. Completed files are released after seven days by the worker's bounded cleanup pass.

Apply `2026-07-12_export_job_reliability.sql` before using the upgraded worker. Monitor `pending` jobs with increasing `attempt_count`, `running` jobs whose `lease_expires_at` has passed, and final `failed` jobs. Do not expose the export directory through a reverse proxy or CDN.

## Observability and recovery outcomes

`GET /api/v5/admin/maintenance/overview` exposes `summary.overdue_windows`, `summary.overdue_work_orders`, and the latest `scheduler` record for `maintenance-window-lifecycle`. Treat scheduler states `failed` and `never_run`, or non-zero overdue counts, as operational signals requiring investigation. The scheduler deliberately does not auto-close overdue work orders or auto-recover devices.

A terminal work-order update with `restore_available=true` returns a `recovery` object. When recovery is blocked, the device remains `maintenance` with reservations disabled and `recovery.blockers` contains one or more stable codes: `active_maintenance_window`, `open_fault_report`, and `open_maintenance_work_order`. Resolve every reported blocker, then make an explicit recovery request again; do not manually override availability without recording the operational reason.

## Return handover and overdue operations

A user-submitted return is a handover request, not an immediate availability change. The record enters `return_pending` for a normal return or `abnormal_pending` for an abnormal return; the device remains unavailable until an authorised operator reviews it through `GET /api/v5/admin/return-tasks` and `PATCH /api/v5/admin/return-tasks/:id/review`. A successful normal acceptance writes a `receive_records` audit record and restores the device to `available`. Marking a return abnormal keeps the device blocked for fault and maintenance handling.

The same task queue also includes `in_use` borrow records past `expected_return_time`. Treat overdue borrow, pending acceptance, and abnormal return counts as operational tasks; do not force a device to available outside the review flow.


## Database backup

Daily full logical backups are produced by `npm run db:backup` (see `docs/production-security-checklist.md`).

- Install Linux cron: `bash scripts/install-backup-schedule.sh`
- Verify latest dump: `npm run db:backup:verify`
- Default retention: 14 days (`BACKUP_RETENTION_DAYS`)
- Do not treat business CSV exports as a substitute for database backups.

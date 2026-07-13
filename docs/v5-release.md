# IDBS 5.0 Release and Acceptance Guide

**Updated:** 2026-07-12  
**Product version:** 5.0.0

## Product scope

IDBS 5.0 is a general-purpose device operations and reservation system. It supports device inventory, user access, reservations, borrowing and return, fault handling, notifications, real-time collaboration, analytics, export jobs, and preventive maintenance.

The current release does **not** include payment, pricing, invoices, refunds, billing, or settlement capabilities. It is not positioned as a higher-education-only product; organization-specific terminology and configuration should be adapted during deployment.

## 5.0 maintenance capability

- Preventive maintenance plans with active, paused, and archived states.
- Work orders with pending, in-progress, completed, and cancelled states.
- Reservation-blocking maintenance windows with scheduled, active, completed, and cancelled states.
- Device-level transaction advisory locks for reservation creation, reservation rescheduling, maintenance-window creation, and maintenance status changes.
- Conflict checks are repeated inside the locked transaction before reservations are written.
- Plan, fault report, device, and assignee relationship validation prevents cross-device work orders and invalid assignees.
- Scheduled maintenance windows automatically activate when their start time is reached; the affected device enters maintenance and reservations are disabled.
- Overdue open windows send one in-app reminder to the assignee and work-order creator. Windows never auto-complete and device recovery remains an explicit administrator decision.

Operational details are in [maintenance-operations.md](maintenance-operations.md). API routes and request contracts are in [v5-api-contract.md](v5-api-contract.md).

## Release procedure

1. Back up PostgreSQL and uploaded files. Verify the target environment configuration without exposing credentials.
2. Install locked dependencies:
   ```bash
   npm ci
   npm --prefix web ci
   ```
3. Run the quality gate:
   ```bash
   npm run v5:quality
   ```
4. Apply only forward migrations, then reconcile the schema:
   ```bash
   npm run db:migrate
   npm run db:upgrade-schema
   npm run doctor
   ```
5. Deploy the application and verify health, administrator sign-in, a reservation conflict, and the maintenance overview endpoint.
6. Confirm that one instance claims each scheduled job run in `scheduled_job_runs`.

Do not run a schema reset against a populated production database. Use an isolated database for reset, migration rehearsal, and test data.

## Acceptance checklist

- The backend and web application both report version 5.0.0.
- `npm run v5:quality` completes successfully.
- All 5.0 API contract routes are documented and protected by their expected authorization rules.
- A reservation overlapping a scheduled or active maintenance window is rejected.
- A due maintenance window changes to active and sets the device to maintenance.
- Completing or cancelling a work order does not restore a device while another maintenance window, open work order, or open fault report remains.
- No payment, billing, refund, or settlement endpoint is exposed.

# IDBS 5.0 API and Realtime Contract

## Scope and stable paths

IDBS product release is **5.0.0**. The deployed React application and its HTTP
contract intentionally keep the stable compatibility paths `/v5/` and
`/api/v5`; these path names are not the product version. New integrations must
use the endpoints in this document. The older `/api/*` compatibility surface is
documented separately in [api-contract.md](./api-contract.md) and must not be
used for new clients.

Base URL examples below omit the host. Unless an endpoint is marked public,
send `Authorization: Bearer <access-token>`. Successful HTTP responses use:

```json
{ "code": 0, "data": {}, "message": "success" }
```

Failures return `{ "ok": false, "code", "status", "message", "data" }`.
Clients may request RFC 7807 problem JSON with
`Accept: application/problem+json` (or `?problem=1`). Never put access or
refresh tokens in a URL.

## Authentication and session

- `POST /api/v5/auth/login` - sign in with phone and password.
- `POST /api/v5/auth/login` - sign in using the bootstrap administrator password.
- `GET /api/v5/auth/wechat/challenge` - obtain a WeChat binding challenge.
- `GET /api/v5/auth/wechat/status` - poll a WeChat binding challenge; requires `code`.
- `POST /api/v5/auth/wechat/bind` - bind the confirmed WeChat identity.
- `POST /api/v5/auth/refresh` - rotate the current refresh session.
- `POST /api/v5/auth/logout` - revoke the current refresh session.
- `GET /api/v5/me` - return the current principal, roles, and permissions.

Login returns only the short-lived access token and user/permission data. The
refresh token is an `idbs.refresh_token` HttpOnly, SameSite=Strict cookie scoped
to `/api/v5/auth` (and is Secure on HTTPS). It is rotated after each successful
refresh. New clients must not send a refresh token in JSON.

## Public catalog and calendar

- `GET /api/v5/devices` - searchable device catalog.
- `GET /api/v5/devices/:deviceCode` - one device and its availability summary.
- `GET /api/v5/device-time-slots` - selectable slots for a device/date query.
- `GET /api/v5/reservation-slots` - reservation slot options.
- `GET /api/v5/system/notice` - public system notice.
- `GET /api/v5/system/staff-contacts` - public support contacts.
- `GET /api/v5/calendar` - calendar events; authentication is optional.
- `GET /api/v5/calendar/days/:date` - one calendar day; authentication is optional.

## User reservations, borrowing, reports, and requests

- `POST /api/v5/reservation-batches/precheck` - validate a proposed reservation batch.
- `POST /api/v5/reservation-batches` - create a reservation batch.
- `GET /api/v5/reservation-batches/me` - list the current user's batches.
- `POST /api/v5/reservation-batches/:id/start-use` - start every currently eligible approved item in a reservation batch; future items remain waiting.
- `GET /api/v5/reservation-batches/:id` - read a current-user batch.
- `PATCH /api/v5/reservation-items/:id/cancel` - cancel one reservation item.
- `GET /api/v5/my-records` - list the current user's borrowing records.
- `POST /api/v5/borrow-records` - start a borrowing record.
- `POST /api/v5/borrow-records/:recordId/extend/precheck` - precheck a default or manually selected extension and return explicit conflict reasons.
- `PATCH /api/v5/borrow-records/:recordId/extend` - extend an active borrowing record after the server repeats the precheck.
- `PUT /api/v5/borrow-records/:recordId/return` - submit a return.
- `PATCH /api/v5/borrow-records/:recordId/return-supplement` - add requested photos or notes to an abnormal return; records whether the one-hour deadline was missed.
- `GET /api/v5/fault-reports` - list the current user's fault reports.
- `POST /api/v5/fault-reports` - submit a fault report.
- `GET /api/v5/user-requests` - list the current user's service requests.
- `POST /api/v5/user-requests` - create a service request.
- `PUT /api/v5/user-requests/:id` - update an editable service request.
- `PATCH /api/v5/user-requests/:id/cancel` - cancel a service request.
- `POST /api/v5/user-requests/:id/change-request` - request a change to a service request.

All endpoints in this section require authentication.

## Notifications and realtime collaboration

- `GET /api/v5/notifications` - list notifications.
- `PATCH /api/v5/notifications/read` - mark notifications read.
- `GET /api/v5/chat/users` - list users available for a conversation.
- `GET /api/v5/chat/conversations` - list conversations.
- `POST /api/v5/chat/conversations` - create a conversation.
- `GET /api/v5/chat/conversations/:id/messages` - list messages.
- `POST /api/v5/chat/conversations/:id/messages` - send a message.
- `PATCH /api/v5/chat/conversations/:id/read` - acknowledge messages as read.
- `POST /api/v5/chat/conversations/:id/participants` - add participants.
- `DELETE /api/v5/chat/conversations/:id/participants/:userId` - remove a participant.
- `POST /api/v5/chat/conversations/:id/participants/:userId/remove` - participant-removal compatibility action.
- `POST /api/v5/chat/conversations/:id/leave` - leave a conversation.
- `DELETE /api/v5/chat/conversations/:id` - delete or close a conversation when permitted.
- `GET /api/v5/chat/events` - legacy SSE event feed; 5.0 clients use WebSocket.
- `WS /api/v5/ws` - realtime notifications and chat events.

Open the WebSocket without a query-string token, then within 10 seconds send:

```json
{ "type": "auth", "token": "<access-token>" }
```

After `ready`, subscribe with `{ "type": "subscribe", "channel":
"chat:<conversation-id>" }`. Only conversation members may subscribe. Use
`unsubscribe` and `ping` as needed; reconnecting clients must authenticate and
subscribe again.

## Administration

All administration endpoints require authentication and the permission enforced
by the server. Do not infer authorization only from a visible menu item.

### Devices and users

- `POST /api/v5/admin/devices` - create a device.
- `PUT /api/v5/admin/devices/:deviceId` - update a device.
- `GET /api/v5/admin/devices` - list managed devices.
- `GET /api/v5/admin/devices/:id` - read managed device detail.
- `PATCH /api/v5/admin/devices/:id/availability` - change availability.
- `GET /api/v5/admin/users` - list users.
- `GET /api/v5/admin/users/:id` - read a user.
- `PATCH /api/v5/admin/users/:id/status` - change user status.
- `PUT /api/v5/admin/users/:id/ban` - ban or unban a user.
- `DELETE /api/v5/admin/users/:id/wechat-binding` - remove a WeChat binding.
- `DELETE /api/v5/admin/users/:id` - delete a user when allowed.

### Operations, reservations, faults, and requests

- `GET /api/v5/admin/dashboard` - operations dashboard.
- `GET /api/v5/admin/reservations` - reservation work queue.
- `GET /api/v5/admin/reservation-batches` - reservation batches.
- `GET /api/v5/admin/reservation-batches/:id` - reservation batch detail and risk data.
- `PATCH /api/v5/admin/reservation-batches/:id/approval` - review a batch.
- `PATCH /api/v5/admin/reservation-items/:id/approval` - review an item.
- `PATCH /api/v5/admin/reservation-items/:id/plan` - update an item plan.
- `PATCH /api/v5/admin/reservation-items/:id/cancel-review` - approve or reject a same-day cancellation request.
- `PATCH /api/v5/admin/reservation-items/:id/no-show` - confirm a no-show and record its reason category.
- `GET /api/v5/admin/fault-reports` - fault-report work queue.
- `GET /api/v5/admin/return-tasks` - overdue borrow, pending handover acceptance, and abnormal return work queue.
- `PATCH /api/v5/admin/return-tasks/:id/review` - accept a normal return or retain an abnormal return; records a handover receipt and only restores availability after acceptance.
- `PATCH /api/v5/admin/fault-reports/:id/resolve` - resolve a fault report.
- `POST /api/v5/admin/fault-reports/:id/notify-affected` - notify the current borrower and affected future reservation users.
- `GET /api/v5/admin/user-requests` - service-request work queue.
- `PATCH /api/v5/admin/user-requests/:id/review` - review a service request.

### Analytics, export, system, and audit

- `GET /api/v5/admin/analytics/overview` - analytics overview.
- `GET /api/v5/admin/analytics/device-usage` - device usage analytics.
- `GET /api/v5/admin/analytics/time-heatmap` - time heatmap analytics.
- `GET /api/v5/admin/analytics/faults` - fault analytics.
- `GET /api/v5/admin/analytics/intelligence` - intelligent operations recommendations.
- `GET /api/v5/admin/analytics/intelligence/actions` - recommendation action queue.
- `PATCH /api/v5/admin/analytics/intelligence/actions/:actionId` - update an action outcome.
- `GET /api/v5/admin/exports/:type` - synchronous export when permitted.
- `POST /api/v5/admin/export-jobs` - create an export job.
- `GET /api/v5/admin/export-jobs` - list export jobs.
- `POST /api/v5/admin/export-jobs/run-next` - run the next queued export job.
- `GET /api/v5/admin/maintenance/overview` - maintenance plan, work-order and active-window summary, including overdue window/work-order counts and the latest `maintenance-window-lifecycle` scheduler result.
- `GET /api/v5/admin/maintenance/plans` - list preventive maintenance plans.
- `POST /api/v5/admin/maintenance/plans` - create a preventive maintenance plan.
- `PATCH /api/v5/admin/maintenance/plans/:id` - update a maintenance plan.
- `GET /api/v5/admin/maintenance/work-orders` - list maintenance work orders.
- `POST /api/v5/admin/maintenance/work-orders` - create a work order and its reservation-blocking maintenance window; affected reservation holders are notified.
- `PATCH /api/v5/admin/maintenance/work-orders/:id` - update work-order progress, completion notes and optional device recovery; terminal updates return `recovery` (`requested`, `recovered`, `blocked`, `blockers`). Blocker codes are `active_maintenance_window`, `open_fault_report`, and `open_maintenance_work_order`.

Maintenance lifecycle behavior: scheduled windows block new overlapping reservations immediately. The runtime scheduler activates due windows, disables reservations for the device, and sends one overdue in-app reminder for an open window. It never auto-completes work orders or automatically restores a device.
- `GET /api/v5/admin/system/runtime` - super-administrator runtime diagnosis; exposes readiness, PostgreSQL round-trip latency, and component status without credentials or connection details.
- `GET /api/v5/admin/system/security-config` - read security configuration.
- `PUT /api/v5/admin/system/security-config` - update security configuration.
- `GET /api/v5/admin/system/activity-summary` - activity summary.
- `GET /api/v5/admin/system/reports/daily-usage` - preview daily usage report.
- `POST /api/v5/admin/system/reports/daily-usage/send` - send daily usage report.
- `GET /api/v5/admin/system/roles` - list role assignments.
- `PUT /api/v5/admin/system/roles` - update role assignments.
- `DELETE /api/v5/admin/system/roles/:userId` - remove a role assignment.
- `GET /api/v5/admin/audit/operation-logs` - query operation audit logs.

## Operational endpoints and non-v5 integrations

- `GET /health` - liveness endpoint; stays available even if PostgreSQL is unavailable.
- `GET /ready` - readiness endpoint; returns 503 if required dependencies are unavailable and includes PostgreSQL round-trip latency when a database is configured.
- `POST /api/upload` - multipart file upload (`file` field); this is a retained shared upload path.
- `GET /wechat` and `POST /wechat` - WeChat public-account verification and callback integration.

## Contract verification

`npm run check` runs `scripts/check-v5-api-contract.js`. It derives every
Express route declared by `src/routes/v5/auth.js` and `src/routes/v5/index.js`
and fails when this document does not list its method and path. Update this
contract in the same change as any 5.0 endpoint change.

### Export job delivery and reliability

- `GET /api/v5/admin/export-jobs/:id/download` downloads a completed CSV only after authentication, export permission checks, creator/super-admin access checks, and an on-disk file check.
- `file_path` is intentionally not returned by export-job APIs. Use `download_url` with the authenticated client instead.
- Export workers claim pending or expired-lease jobs atomically, publish only with their lease token, retry transient failures with bounded backoff, and release completed files after seven days.

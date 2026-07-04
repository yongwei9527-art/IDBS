# API Contract

This document defines the REST-style API contract for the rental system.
The legacy `POST /api/:action` entry has been removed. Clients must integrate
against the routes below.

## Base Rules

- Base path: `/api`
- Content type: `application/json`
- Auth header: `Authorization: Bearer <token>`
- Time format: ISO 8601, for example `2026-06-24T09:00:00.000Z`

## Response Format

Successful response:

```json
{
  "ok": true,
  "code": 0,
  "message": "success",
  "data": {},
  "request_id": "lx1v9s-abc123",
  "server_time": "2026-07-02T02:30:00.000Z"
}
```

Failed response:

```json
{
  "ok": false,
  "code": 2001,
  "message": "request failed",
  "data": null,
  "request_id": "lx1v9s-abc123",
  "server_time": "2026-07-02T02:30:00.000Z"
}
```

## Error Codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1001` | Authentication required or token invalid |
| `1003` | Forbidden or role not allowed |
| `2001` | Request parameter validation failed |
| `3001` | Business rule conflict |
| `3004` | Resource not found |
| `5000` | Internal server error |

## Auth Endpoints

### `POST /api/auth/register`

- Status: disabled for public registration
- Auth: none
- Response: `403`
- Message: new users must complete first-time registration/binding through the official-account challenge flow.

Use these endpoints instead:

- `GET /api/login/challenge`
- `GET /api/login/status?code=<challenge-code>`
- `POST /api/login/bind`

The bind endpoint requires the WeChat OpenID to be captured through the public-account challenge before it accepts identity details.

Bind body:

```json
{
  "temp_code": "12345",
  "name": "Alice",
  "phone": "13800000000",
  "student_no": "20260001"
}
```

If no existing user matches the name and student number, the server creates a pending user with the captured WeChat OpenID and waits for administrator approval.

### `POST /api/auth/login`

- Auth: none
- Body:

```json
{
  "phone": "13800000000",
  "password": "secret"
}
```

- Success data:

```json
{
  "token": "jwt-like-token",
  "role": "user",
  "user": {}
}
```

### `POST /api/admin/auth/login`

- Auth: none
- Body:

```json
{
  "password": "admin-password"
}
```

### `GET /api/login/challenge`

- Auth: none
- Returns:

```json
{
  "code": "58321",
  "expire_minutes": 3,
  "hourly_limit": 3,
  "tips": "Send this code to the official account within the valid time."
}
```

### `GET /api/login/status?code=58321`

- Auth: none
- Used for polling the public-account login result
- Return states:
  - waiting for scan: `logged_in=false`, `need_bind=false`
  - first bind required: `logged_in=false`, `need_bind=true`
  - already bound and login completed: returns the same token payload as `POST /api/auth/login`

### `POST /api/login/bind`

- Auth: none
- Body:

```json
{
  "temp_code": "58321",
  "name": "Alice",
  "student_no": "20260001"
}
```

- Returns the same token payload as `POST /api/auth/login`

## User Endpoints

### `GET /api/users/profile`

- Auth: user

### `GET /api/bookings/me`

- Auth: user
- Returns:

```json
{
  "reservations": [],
  "borrows": []
}
```

## Device Endpoints

### `GET /api/devices`

- Auth: none
- Query:
  - `status`
  - `category`
  - `keyword`

- Returns:

```json
{
  "list": [],
  "total": 0
}
```

### `GET /api/devices/:deviceCode`

- Auth: none
- Returns:

```json
{
  "device": {},
  "reservations": [],
  "occupancy_14_days": [],
  "recent_fault_reports": [],
  "current_borrow": null,
  "next_reservation": null,
  "last_record": null
}
```

- `occupancy_14_days` is a compact upcoming occupancy list for the device detail page.
- `recent_fault_reports` is the latest device fault summary when the fault-report migration exists.

### `POST /api/upload`

- Auth: none
- Content type: `multipart/form-data`
- Form field: `file`
- Accepted content types: JPEG, PNG, WebP and GIF
- The server verifies the file signature and stores the image with a random filename.

## Booking And Borrowing

### `POST /api/bookings`

- Auth: user
- Body:

```json
{
  "device_codes": ["EQ-001", "EQ-002"],
  "time_slots": [
    "2026-06-25T01:00:00.000Z - 2026-06-25T03:00:00.000Z",
    "2026-06-26T01:00:00.000Z - 2026-06-26T03:00:00.000Z"
  ],
  "purpose": "Course experiment"
}
```

- Response includes `batch_id` plus the created reservation rows. Legacy `device_code` with `start_time`/`end_time` is still accepted and normalized by the API.

### `POST /api/bookings/precheck`

- Auth: user
- Same payload as `POST /api/bookings`
- Checks account state, device availability, duplicated selections and active reservation conflicts without creating records.
- Returns:

```json
{
  "available": false,
  "total": 2,
  "conflicts": [
    {
      "type": "occupied",
      "device_code": "EQ-001",
      "start_time": "2026-07-03T00:00:00.000Z",
      "end_time": "2026-07-03T04:00:00.000Z",
      "reason": "EQ-001 在该时段已有预约或使用记录。"
    }
  ]
}
```

### `POST /api/borrow-records`

- Auth: user
- Body:

```json
{
  "reservation_id": "reservation-uuid"
}
```

### `PUT /api/borrow-records/:recordId/return`

- Auth: user
- Body:

```json
{
  "return_condition": "normal",
  "return_note": "",
  "return_photos": []
}
```

## Notifications

### `GET /api/notifications`

- Auth: user
- Query:
  - `limit`, default `50`, max `100`
- Returns:

```json
{
  "notifications": [],
  "unread_count": 0,
  "migration_required": false
}
```

### `PATCH /api/notifications/read`

- Auth: user
- Body:

```json
{
  "ids": ["notification-uuid"]
}
```

- If `ids` is omitted, all current user's unread notifications are marked read.

## Chat

### `GET /api/chat/users`

- Auth: user or admin
- Query:
  - `keyword`
- Returns active contacts plus `current_user`.

### `GET /api/chat/conversations`

- Auth: user or admin
- Query:
  - `limit`, default `50`, max `100`
- Returns conversations, participants, latest message and `unread_count`.

### `POST /api/chat/conversations`

- Auth: user or admin
- Body for direct chat:

```json
{
  "type": "direct",
  "user_id": "target-user-uuid"
}
```

- Body for group chat:

```json
{
  "type": "group",
  "title": "预约沟通",
  "user_ids": ["user-a", "user-b"]
}
```

### `GET /api/chat/conversations/:conversationId/messages`

- Auth: conversation participant
- Query:
  - `limit`, default `80`, max `200`
  - `before`, optional ISO time for older-page pagination
- Returns:

```json
{
  "conversation": {},
  "messages": [],
  "current_user": {},
  "page": {
    "limit": 80,
    "has_more": false,
    "next_before": "2026-07-02T10:00:00.000Z"
  }
}
```

### `POST /api/chat/conversations/:conversationId/messages`

- Auth: conversation participant
- Body:

```json
{
  "content": "请确认设备状态",
  "message_type": "text",
  "attachments": [],
  "metadata": {},
  "related_type": "",
  "related_id": "",
  "client_message_id": "web-unique-id",
  "mention_user_ids": ["user-uuid"],
  "mention_all": false
}
```

- `message_type` supports `text`, `image`, `file`, `system`, `device_card`, `reservation_card`, `fault_card`, and `user_request_card`.
- Image messages should upload with `POST /api/upload` first, then send `attachments: [{ "type": "image", "url": "/uploads/...", "name": "photo.jpg" }]`.
- Card messages use `metadata` to carry lightweight context such as `device_code`, `reservation_id`, `batch_id`, `fault_id`, `request_id`, `title`, and `status`.
- `related_type`/`related_id` are optional query keys for later filtering and audit linkage.

### `POST /api/chat/conversations/:conversationId/participants`

- Auth: group owner, participant admin, or system admin
- Body:

```json
{
  "user_ids": ["user-uuid"]
}
```

### `DELETE /api/chat/conversations/:conversationId/participants/:userId`

- Auth: group owner, participant admin, or system admin
- Removes one member. The management group cannot be used to remove a super admin.

### `POST /api/chat/conversations/:conversationId/leave`

- Auth: group participant
- Lets a participant leave a normal group they are in.
- The lab management group cannot be left manually.
- A group creator should dissolve the group instead of leaving it.

### `DELETE /api/chat/conversations/:conversationId`

- Auth: group creator
- Dissolves a normal group created by the current user/admin.
- The system management group cannot be dissolved.

### `GET /api/chat/events`

- Auth: user or admin
- Transport: Server-Sent Events
- Browser `EventSource` clients pass `token` as a query parameter because custom headers are not supported:

```text
/api/chat/events?token=<token>
```

- Events:
  - `ready`
  - `heartbeat`
  - `message`
  - `conversation_changed`
  - `conversation_deleted`
- If SSE is unavailable, clients should fall back to polling `GET /api/chat/conversations` and the active messages endpoint.

## Reservation Batches And Items

`reservation_batches` is the submission-level record and `reservation_items` is the item-level source for reservation creation, approval, calendar, borrow/return and fault workflows. `/bookings` paths are REST aliases for existing clients; new code should use `/reservation-batches` and `/reservation-items`. The old `reservations` table is legacy shadow data only and must not be treated as the business source of truth.

### `POST /api/reservation-batches`

- Auth: user
- Same payload as `POST /api/bookings`
- Creates one batch plus one or more reservation items. Compatibility `reservations` rows are not required for new submissions.

### `POST /api/reservation-batches/precheck`

- Auth: user
- Same payload as `POST /api/reservation-batches`
- Same response shape as `POST /api/bookings/precheck`

### `GET /api/reservation-batches/me`

- Auth: user
- Returns the current user's batches and item counts.

### `GET /api/reservation-batches/:id`

- Auth: user
- Returns one batch and its items.

### `PATCH /api/reservation-items/:id/cancel`

- Auth: user
- Cancels one item when business rules allow it.

## Admin Endpoints

### `GET /api/admin/users`

- Auth: admin

### `GET /api/admin/users/:userId/detail`

- Auth: admin, ops or auditor with user/reservation/statistics permission
- Returns user profile plus recent reservations, borrow records, fault reports, user requests and activity logs.

### `PUT /api/admin/users/:userId/status`

- Auth: admin
- Body:

```json
{
  "status": "active"
}
```

### `PUT /api/admin/users/:userId/ban`

- Auth: admin
- Body:

```json
{
  "is_banned": true
}
```

### `DELETE /api/admin/users/:userId/wechat-binding`

- Auth: admin
- Removes the current WeChat/OpenID binding

### `POST /api/admin/devices`

- Auth: admin

### `PUT /api/admin/devices/:deviceId`

- Auth: admin

### `GET /api/admin/devices/:deviceId/detail`

- Auth: admin, ops or auditor with device/reservation/statistics permission
- Returns device profile plus reservation, borrow and fault-report history.

### `PUT /api/admin/devices/:deviceId/availability`

- Auth: admin

### `GET /api/admin/bookings`

- Auth: admin

### `GET /api/admin/reservation-batches`

- Auth: admin
- Returns reservation batches for approval workbench views.

### `GET /api/admin/reservation-batches/:id`

- Auth: admin
- Returns one batch, its user/device context and item rows.

### `PATCH /api/admin/reservation-batches/:id/approval`

- Auth: admin with reservation approval permission
- Body:

```json
{
  "approve": true,
  "admin_note": "approved"
}
```

### `PATCH /api/admin/reservation-items/:id/approval`

- Auth: admin with reservation approval permission
- Approves or rejects one reservation item.

### `PATCH /api/admin/bookings/:reservationId/approval`

- Auth: admin
- Body:

```json
{
  "approve": true,
  "admin_note": "approved"
}
```

### `GET /api/admin/statistics/usage`

- Auth: admin
- Query:
  - `user_id`
  - `device_id`
  - `start_date`
  - `end_date`

### `GET /api/admin/exports/:type`

- Auth: admin with `stats.view` and `stats.export`
- `type`: `usage`, `reservations`, `faults`, `user_activity`, or `device_summary`
- Query: same filters as statistics where applicable: `user_id`, `device_id`, `start_date`, `end_date`
- Returns normalized rows for CSV or Excel-style export.

### `GET /api/admin/options`

- Auth: admin

### `GET /api/admin/fault-reports`

- Auth: admin with fault management permission

### `PATCH /api/admin/fault-reports/:reportId`

- Auth: admin with fault management permission
- Body includes `status`, `admin_note`, and optional device availability action.
- `status`: `pending`, `processing`, `resolved`, or `closed`
- `set_available: true` resolves and restores the device to available.
- `keep_maintenance: true` resolves or closes the report while keeping the device in maintenance.

### `GET /api/admin/permissions`

- Auth: admin
- Returns role and permission metadata.

### `GET /api/admin/analytics/overview`

- Auth: admin with statistics permission
- Query: `range`, `start_date`, `end_date`

### `GET /api/admin/analytics/device-usage`

- Auth: admin with statistics permission
- Query: `metric`

### `GET /api/admin/analytics/time-heatmap`

- Auth: admin with statistics permission

### `GET /api/admin/analytics/faults`

- Auth: admin with statistics permission

### `GET /api/admin/security-config`

- Auth: admin

### `PUT /api/admin/security-config`

- Auth: admin
- Body:

```json
{
  "captcha_expire_minutes": 3,
  "captcha_hourly_limit": 3,
  "openid_daily_register_limit": 1,
  "enable_image_captcha": false
}
```

### `GET /api/admin/activity-summary`

- Auth: admin
- Returns today's registration, login, WeChat bind, and verification activity summary

### `GET /api/admin/reports/daily-usage`

- Auth: admin
- Query:
  - `date` optional, format `YYYY-MM-DD`
  - `timezone` optional, default `Asia/Shanghai`
- Used to preview the generated daily usage report text

### `POST /api/admin/reports/daily-usage/send`

- Auth: admin
- Body:

```json
{
  "date": "2026-06-24",
  "timezone": "Asia/Shanghai",
  "openids": ["openid_a", "openid_b"]
}
```

- If `openids` is omitted, the server falls back to `WECHAT_ADMIN_OPENIDS`
- The server sends text through the official-account customer-service API
- Note: this channel is still subject to WeChat's customer-service delivery rules, including recent user interaction requirements

## WeChat Callback

### `GET /wechat`

- Used by the WeChat public-platform server for signature verification
- Required env var: `WECHAT_TOKEN`

### `POST /wechat`

- Accepts the XML message callback from the public account
- Current supported message type: plain text challenge code
- Successful reply:
  - known bound user: asks the user to return to the system page and login completes on poll
  - first-time WeChat user: asks the user to go back and finish binding

## Legacy Mapping

| Legacy action | New route |
| --- | --- |
| `registerUser` | `POST /api/auth/register` disabled; use `GET /api/login/challenge` + `POST /api/login/bind` |
| `loginUser` | `POST /api/auth/login` |
| `adminLogin` | `POST /api/admin/auth/login` |
| `listDevices` | `GET /api/devices` |
| `getDeviceDetail` | `GET /api/devices/:deviceCode` |
| `createReservation` | `POST /api/reservation-batches` (`POST /api/bookings` remains an alias) |
| `myRecords` | `GET /api/bookings/me` |
| `startUse` | `POST /api/borrow-records` |
| `submitReturn` | `PUT /api/borrow-records/:recordId/return` |
| `adminListUsers` | `GET /api/admin/users` |
| `adminGetUserDetail` | `GET /api/admin/users/:userId/detail` |
| `adminSetUserStatus` | `PUT /api/admin/users/:userId/status` |
| `adminSetUserBan` | `PUT /api/admin/users/:userId/ban` |
| `adminUnbindWechat` | `DELETE /api/admin/users/:userId/wechat-binding` |
| `adminCreateDevice` | `POST /api/admin/devices` |
| `adminGetDeviceDetail` | `GET /api/admin/devices/:deviceId/detail` |
| `adminUpdateDevice` | `PUT /api/admin/devices/:deviceId` |
| `adminListReservations` | `GET /api/admin/bookings` |
| `adminApproveReservation` | `PATCH /api/admin/bookings/:reservationId/approval` |
| `adminSetDeviceAvailable` | `PUT /api/admin/devices/:deviceId/availability` |
| `createLoginChallenge` | `GET /api/login/challenge` |
| `getLoginChallengeStatus` | `GET /api/login/status` |
| `bindWechatAccount` | `POST /api/login/bind` |
| `adminGetSecurityConfig` | `GET /api/admin/security-config` |
| `adminUpdateSecurityConfig` | `PUT /api/admin/security-config` |
| `adminGetActivitySummary` | `GET /api/admin/activity-summary` |
| `usageStats` | `GET /api/admin/statistics/usage` |
| `adminExportData` | `GET /api/admin/exports/:type` |
| `adminOptions` | `GET /api/admin/options` |

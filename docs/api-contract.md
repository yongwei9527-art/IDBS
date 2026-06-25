# API Contract

This document defines the new REST-style API contract for the rental system.
The legacy `POST /api/:action` entry is still available for compatibility, but
new clients should only integrate against the routes below.

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
  "data": {}
}
```

Failed response:

```json
{
  "ok": false,
  "code": 2001,
  "message": "request failed",
  "data": null
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

### `POST /api/upload`

- Auth: none
- Content type: `multipart/form-data`
- Form field: `file`

## Booking And Borrowing

### `POST /api/bookings`

- Auth: user
- Body:

```json
{
  "device_code": "EQ-001",
  "start_time": "2026-06-25T01:00:00.000Z",
  "end_time": "2026-06-25T03:00:00.000Z",
  "purpose": "Course experiment"
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

## Admin Endpoints

### `GET /api/admin/users`

- Auth: admin

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

### `PUT /api/admin/devices/:deviceId/availability`

- Auth: admin

### `GET /api/admin/bookings`

- Auth: admin

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

### `GET /api/admin/options`

- Auth: admin

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
| `createReservation` | `POST /api/bookings` |
| `myRecords` | `GET /api/bookings/me` |
| `startUse` | `POST /api/borrow-records` |
| `submitReturn` | `PUT /api/borrow-records/:recordId/return` |
| `adminListUsers` | `GET /api/admin/users` |
| `adminSetUserStatus` | `PUT /api/admin/users/:userId/status` |
| `adminSetUserBan` | `PUT /api/admin/users/:userId/ban` |
| `adminUnbindWechat` | `DELETE /api/admin/users/:userId/wechat-binding` |
| `adminCreateDevice` | `POST /api/admin/devices` |
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
| `adminOptions` | `GET /api/admin/options` |

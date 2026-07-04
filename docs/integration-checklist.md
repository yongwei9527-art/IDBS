# Integration Checklist

This checklist is for IDBS VPS + PostgreSQL deployment, frontend/backend integration, smoke verification, and go-live checks.

## 1. Server Readiness

- Confirm service is running: `sudo systemctl status idbs`
- Confirm reverse proxy is healthy: `sudo nginx -t`
- Confirm basic health endpoint: `curl http://127.0.0.1:3000/health`
- Confirm readiness endpoint: `curl http://127.0.0.1:3000/ready`
- Run local syntax checks before deploying: `npm run check`
- Run smoke test from `/var/www/idbs/current`: `npm run smoke -- http://127.0.0.1:3000`
- For local E2E verification, start the service with a non-production test-only rate-limit override when necessary, for example `API_RATE_LIMIT_MAX=1000`, then run `npm run e2e` against the same base URL.

## 2. Environment Variables

Required production values are stored in `/var/www/idbs/shared/.env`:

```bash
PORT=3000
ADMIN_PASSWORD=<strong-password>
TOKEN_SECRET=<long-random-secret>
UPLOAD_DIR=/var/www/idbs/uploads
DATABASE_URL=postgresql://idbs_user:<password>@127.0.0.1:5432/idbs
PGSSL=false
CORS_ORIGIN=https://your-domain.com
```

Optional WeChat values:

```bash
WECHAT_TOKEN=<wechat-callback-token>
WECHAT_APP_ID=<official-account-appid>
WECHAT_APP_SECRET=<official-account-secret>
WECHAT_ADMIN_OPENIDS=<openid_a,openid_b>
```

## 3. Database Checks

- Confirm PostgreSQL is running: `sudo systemctl status postgresql`
- Confirm schema exists: `sudo -u postgres psql -d idbs -c "\dt"`
- Confirm app user can connect: `psql "$DATABASE_URL" -c "select 1"`
- Apply schema upgrades with a table owner or PostgreSQL superuser, not a limited runtime account, because migrations may run `ALTER TABLE` on existing tables:

  ```bash
  sudo -u postgres psql -d idbs -v ON_ERROR_STOP=1 -f sql/migrations/2026-06-30_long_term_upgrade_foundation.sql
  ```

- Confirm long-term upgrade tables/views exist:

  ```bash
  sudo -u postgres psql -d idbs -c "select to_regclass('public.device_time_slots'), to_regclass('public.reservation_items'), to_regclass('public.permissions'), to_regclass('public.calendar_events_view');"
  ```

- Confirm `/ready` returns `200` after `.env` is finalized and service restarted
- If `npm run db:upgrade-schema` prints a "Manual SQL" block, apply that block with the table owner/PostgreSQL admin account before running smoke tests.
- Confirm item-first reservation columns exist before go-live:

  ```bash
  sudo -u postgres psql -d idbs -c "select column_name from information_schema.columns where table_name in ('borrow_records','device_fault_reports','usage_log') and column_name = 'reservation_item_id';"
  ```

- Confirm chat management group columns exist:

  ```bash
  sudo -u postgres psql -d idbs -c "select column_name from information_schema.columns where table_name = 'chat_conversations' and column_name in ('system_key','is_system','retention_days');"
  ```

## 4. Manual End-To-End User Flow

Run this in order:

1. Open `login.html`
2. Generate a WeChat challenge code
3. Send the challenge code to the official account
4. Complete first-time binding with name, student number, and phone
5. Open `admin.html`
6. Login as admin
7. Approve the new pending user
8. Login as the new user in `login.html`
9. Open `index.html` and confirm device list loads
10. Open a device detail page
11. Create a reservation
12. In admin, approve the reservation
13. In user center, start using the approved reservation
14. In user center, upload return photos and submit return
15. In admin statistics, verify the usage record appears

Expected result:

- No uncaught frontend error
- No `401` after successful login
- Device state changes are reflected correctly
- Borrow/return records show up in both user and admin views

## 5. Admin Flow

- Add a new device
- Verify it appears on the home page
- Submit an abnormal return
- Restore device availability in admin
- Export CSV and Excel from statistics page

Expected result:

- Device creation is visible immediately
- Status badge changes match business flow
- CSV and Excel downloads with readable columns

## 6. API Verification

Recommended requests:

- `POST /api/auth/register` is intentionally disabled for public registration
- `GET /api/login/challenge`
- `GET /api/login/status`
- `POST /api/login/bind`
- `POST /api/auth/login`
- `GET /api/devices`
- `GET /api/devices/:deviceCode`
- `POST /api/bookings`
- `GET /api/bookings/me`
- `POST /api/borrow-records`
- `PUT /api/borrow-records/:recordId/return`
- `GET /api/admin/users`
- `GET /api/admin/users/:userId/detail`
- `GET /api/admin/devices`
- `GET /api/admin/devices/:deviceId/detail`
- `GET /api/admin/bookings`
- `GET /api/admin/statistics/usage`
- `GET /api/admin/exports/usage`
- `GET /api/admin/exports/device_summary`
- `GET /api/admin/reservation-batches`
- `GET /api/admin/reservation-batches/:id`
- `PATCH /api/admin/reservation-items/:id/approval`

Use the contract in [api-contract.md](./api-contract.md).

## 7. Security Checks

- Confirm `TOKEN_SECRET` is not default
- Confirm `ADMIN_PASSWORD` is strong
- Confirm `CORS_ORIGIN` is restricted in production
- Confirm uploads only accept images
- Confirm `/ready` returns `200` without warnings before go-live
- Confirm admin account is not shared broadly

## 8. Stability Checks

- Inspect service logs: `sudo journalctl -u idbs -f`
- Confirm request logs include status and request id
- Confirm repeated refreshes do not crash the service
- Confirm large image uploads are rejected above configured limit
- Confirm rate limiting returns `429` under burst traffic

## 9. Known Constraints

- WeChat cannot recall/delete already-sent public-account messages through a general API.
- Daily report push uses a new message to replace yesterday's attention focus.
- If using an external PostgreSQL instance, update `DATABASE_URL` and `PGSSL`, then restart `idbs`.

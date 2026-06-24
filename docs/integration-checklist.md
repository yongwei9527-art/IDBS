# Integration Checklist

This checklist is for IDBS VPS + PostgreSQL deployment, frontend/backend integration, smoke verification, and go-live checks.

## 1. Server Readiness

- Confirm service is running: `sudo systemctl status idbs`
- Confirm reverse proxy is healthy: `sudo nginx -t`
- Confirm basic health endpoint: `curl http://127.0.0.1:3000/health`
- Confirm readiness endpoint: `curl http://127.0.0.1:3000/ready`
- Run smoke test from `/var/www/idbs/current`: `npm run smoke -- http://127.0.0.1:3000`

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
- Confirm `/ready` returns `200` after `.env` is finalized and service restarted

## 4. Manual End-To-End User Flow

Run this in order:

1. Open `register.html`
2. Create a new normal user
3. Open `admin.html`
4. Login as admin
5. Approve the new user
6. Login as the new user in `login.html`
7. Open `index.html` and confirm device list loads
8. Open a device detail page
9. Create a reservation
10. In admin, approve the reservation
11. In user center, start using the approved reservation
12. In user center, upload return photos and submit return
13. In admin statistics, verify the usage record appears

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
- Export CSV from statistics page

Expected result:

- Device creation is visible immediately
- Status badge changes match business flow
- CSV downloads with readable columns

## 6. API Verification

Recommended requests:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/devices`
- `GET /api/devices/:deviceCode`
- `POST /api/bookings`
- `GET /api/bookings/me`
- `POST /api/borrow-records`
- `PUT /api/borrow-records/:recordId/return`
- `GET /api/admin/users`
- `GET /api/admin/bookings`
- `GET /api/admin/statistics/usage`

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

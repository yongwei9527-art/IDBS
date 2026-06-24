# Integration Checklist

This checklist is for VPS deployment, frontend/backend联调, smoke verification, and go-live sanity checks.

## 1. Server Readiness

- Confirm service is running:
  - `sudo systemctl status idbs`
- Confirm reverse proxy is healthy:
  - `sudo nginx -t`
  - `sudo systemctl status nginx`
- Confirm basic health endpoint:
  - `curl http://127.0.0.1:3000/health`
- Confirm readiness endpoint:
  - `curl http://127.0.0.1:3000/ready`
- Run smoke test:
  - `npm run smoke -- http://127.0.0.1:3000`

## 2. Environment Variables

Required production values:

```bash
PORT=3000
ADMIN_PASSWORD=<strong-password>
TOKEN_SECRET=<long-random-secret>
UPLOAD_DIR=/var/www/idbs/uploads
USE_CLOUDBASE=true
CLOUDBASE_ENV_ID=<cloudbase-env-id>
CLOUDBASE_REGION=ap-shanghai
```

Recommended:

```bash
CORS_ORIGIN=https://your-domain.com
```

## 3. Manual End-To-End User Flow

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
11. In user center, click `开始使用`
12. In user center, upload return photos and submit return
13. In admin statistics, verify usage record appears

Expected result:

- No uncaught frontend error
- No `401` after successful login
- Device state changes are reflected correctly
- Borrow/return records show up in both user and admin views

## 4. Admin Flow

- Add a new device
- Verify it appears on the home page
- Set one device to abnormal flow by submitting an abnormal return
- In admin, restore device availability
- Export CSV from statistics page

Expected result:

- Device creation is visible immediately
- Status badge changes match business flow
- CSV downloads with readable columns

## 5. API Verification

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

## 6. Security Checks

- Confirm `TOKEN_SECRET` is not default
- Confirm `ADMIN_PASSWORD` is strong
- Confirm `CORS_ORIGIN` is restricted in production
- Confirm uploads only accept images
- Confirm `/ready` returns `200` without warnings before go-live
- Confirm admin account is not shared broadly

## 7. Stability Checks

- Inspect service logs:
  - `sudo journalctl -u idbs -f`
- Confirm request logs include status and request id
- Confirm repeated refreshes do not crash the service
- Confirm large image uploads are rejected above configured limit
- Confirm rate limiting returns `429` under burst traffic

## 8. Known Current Constraints

- The app currently depends on CloudBase as the real backend data source.
- If `USE_CLOUDBASE=false`, Node can start, but business APIs do not have a local SQL adapter yet.
- This version is suitable for VPS + CloudBase hybrid deployment, not fully local standalone data mode.

# Rental System VPS Deployment

This project can run on a VPS as a standalone Node.js service.

Important:

- The app server can start in standalone mode.
- The business APIs still require a database backend.
- In the current codebase, the practical production setup is `USE_CLOUDBASE=true`.
- If `USE_CLOUDBASE=false`, the service can boot, but API calls that need data access will fail because no local SQL adapter has been implemented.

## Runtime Layout

- Backend entry: `server.js`
- Static frontend: `public/`
- Upload directory: `uploads/`
- Health check: `GET /health`
- API style:
  - New REST routes such as `GET /api/devices`, `POST /api/auth/login`
  - Legacy compatibility route `POST /api/:action`

## Ubuntu VPS Quick Start

Recommended target system: `Ubuntu 22.04` or `Ubuntu 24.04`

### 1. One-command install from GitHub

After this project is pushed to GitHub, run this on the VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh | bash
```

Optional environment overrides:

```bash
REPO_URL=https://github.com/yongwei9527-art/IDBS.git BRANCH=main SRC_DIR=/var/www/rental-system-src bash -c "$(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)"
```

### 2. Manual upload alternative

Copy the project to your VPS, for example:

```bash
scp -r ./Rental-System user@your-server:/var/www/rental-system-src
```

Then run the deployment script:

```bash
cd /var/www/rental-system-src
chmod +x scripts/deploy-ubuntu.sh
./scripts/deploy-ubuntu.sh
```

This script will:

- install `nginx` and `nodejs`
- copy the app into `/var/www/rental-system/current`
- create `/var/www/rental-system/shared/.env`
- install a `systemd` service
- install an `nginx` site config

### 3. Edit environment variables

Edit:

```bash
sudo nano /var/www/rental-system/shared/.env
```

Suggested configuration:

```bash
PORT=3000
ADMIN_PASSWORD=your-admin-password
TOKEN_SECRET=your-long-random-secret
WECHAT_TOKEN=your-wechat-callback-token
WECHAT_APP_ID=your-wechat-official-account-appid
WECHAT_APP_SECRET=your-wechat-official-account-secret
WECHAT_ADMIN_OPENIDS=openid_a,openid_b
UPLOAD_DIR=/var/www/rental-system/uploads
USE_CLOUDBASE=true
CLOUDBASE_ENV_ID=your-cloudbase-env-id
CLOUDBASE_REGION=ap-shanghai
```

### 4. Run database schema or migration

For a fresh database, run:

```bash
sql/schema.sql
```

For an existing database, run:

```bash
sql/migrations/2026-06-24_wechat_security.sql
```

### 5. Restart the service

```bash
sudo systemctl restart rental-system
sudo systemctl status rental-system
```

### 6. Verify

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1/api/devices
npm run smoke -- http://127.0.0.1:3000
```

## systemd And Nginx Files

- Service template: `deploy/rental-system.service`
- Nginx config: `deploy/nginx.rental-system.conf`

## Frontend Config

The frontend is already set to VPS HTTP mode in `public/js/config.js`:

```js
window.APP_CONFIG = {
  envId: '',
  region: 'ap-shanghai',
  apiFunctionName: 'api',
  apiBaseUrl: window.location.origin,
  useCloudBase: false
};
```

This means:

- browser requests go to your VPS HTTP API
- the server itself talks to CloudBase when `USE_CLOUDBASE=true`

## Common Commands

View service logs:

```bash
sudo journalctl -u rental-system -f
```

Restart service:

```bash
sudo systemctl restart rental-system
```

Reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Current Deployment Recommendation

For this codebase, the safest production path is:

1. Run the Node.js app on Ubuntu VPS
2. Use `nginx` as the reverse proxy
3. Use `systemd` to keep the service alive
4. Set `USE_CLOUDBASE=true`
5. Provide a valid `CLOUDBASE_ENV_ID`

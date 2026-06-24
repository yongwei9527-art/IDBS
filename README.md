# IDBS VPS + PostgreSQL Deployment

IDBS runs on a VPS as a standalone Node.js service backed by PostgreSQL.

Before deploying or using this project, read [DISCLAIMER.md](./DISCLAIMER.md).

## Runtime Layout

- Backend entry: `server.js`
- PostgreSQL access: `src/lib/db.js`
- Static frontend: `public/`
- Upload directory: `uploads/`
- Health check: `GET /health`
- Readiness check: `GET /ready`
- API style:
  - New REST routes such as `GET /api/devices`, `POST /api/auth/login`
  - Legacy compatibility route `POST /api/:action`

## Ubuntu VPS Quick Start

Recommended target system: `Ubuntu 22.04` or `Ubuntu 24.04`

### 1. One-command install from GitHub

After this project is pushed to GitHub, run this on the VPS:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)
```

Optional environment overrides:

```bash
REPO_URL=https://github.com/yongwei9527-art/IDBS.git BRANCH=main SRC_DIR=/var/www/idbs-src bash -c "$(curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/main/scripts/install-vps.sh)"
```

### 2. Manual upload alternative

Copy the project to your VPS, for example:

```bash
scp -r ./IDBS user@your-server:/var/www/idbs-src
```

Then run the deployment script:

```bash
cd /var/www/idbs-src
chmod +x scripts/deploy-ubuntu.sh
./scripts/deploy-ubuntu.sh
```

This script will:

- install `nginx`, `nodejs`, and `postgresql` client tools
- copy the app into `/var/www/idbs/current`
- create `/var/www/idbs/shared/.env`
- install a `systemd` service
- install an `nginx` site config

### 3. Edit environment variables

Edit:

```bash
sudo nano /var/www/idbs/shared/.env
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
UPLOAD_DIR=/var/www/idbs/uploads
DATABASE_URL=postgresql://idbs_user:your-password@127.0.0.1:5432/idbs
PGSSL=false
CORS_ORIGIN=https://your-domain.com
```

### 4. Create the PostgreSQL database

```bash
sudo -u postgres psql
```

Example SQL:

```sql
CREATE DATABASE idbs;
CREATE USER idbs_user WITH ENCRYPTED PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE idbs TO idbs_user;
```

Then run the schema:

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

For later changes, apply migrations from `sql/migrations/`.

### 5. Restart the service

```bash
sudo systemctl restart idbs
sudo systemctl status idbs
```

### 6. Verify

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
curl http://127.0.0.1:3000/api/devices
npm run smoke -- http://127.0.0.1:3000
```

## systemd And Nginx Files

- Service template: `deploy/idbs.service`
- Nginx config: `deploy/nginx.idbs.conf`

## Frontend Config

The frontend is set to VPS HTTP mode in `public/js/config.js`.

This means:

- browser requests go to your VPS HTTP API
- all backend data access is now through PostgreSQL on the server

## Common Commands

View service logs:

```bash
sudo journalctl -u idbs -f
```

Restart service:

```bash
sudo systemctl restart idbs
```

Reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Current Deployment Recommendation

For this codebase, the production path is:

1. Run the Node.js app on an Ubuntu VPS
2. Use PostgreSQL as the backend database
3. Use `nginx` as the reverse proxy
4. Use `systemd` to keep the service alive
5. Set `DATABASE_URL` and `PGSSL` appropriately

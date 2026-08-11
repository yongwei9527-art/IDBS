# IDBS v5.0.8

v5.0.8 focuses on reliable VPS lifecycle management and trusted Android server pairing. It also includes administrator-assisted password recovery, legacy document import, export retention, registration approval-code controls, and management-group announcements.

## Release metadata

- Application version: `5.0.8`
- Android `versionCode`: `50008`
- Android application ID: `com.laboratory.managementsystem`
- Web application path: `/v5/`
- API path: `/api/v5`

## Highlights

- VPS deployments build an isolated release, verify a pre-migration database backup, switch `current` atomically, and retain a previous code release for health-check rollback.
- Database migrations are forward-only and are **not** automatically rolled back with application code.
- The updater no longer exposes the PostgreSQL password in backup command arguments.
- Backup retention removes only recognized project backup artifacts and preserves administrator-created files.
- Full-data uninstall requires explicit confirmation, safe resolved paths, and the root-only installation ownership marker.
- Domain-free installation works over HTTP with a public IPv4 address. A private address detected automatically requires interactive LAN-only confirmation and is rejected in unattended mode.
- The Node.js service listens only on `127.0.0.1`; Nginx provides the public HTTP/HTTPS endpoint.
- Android stores the complete trusted server identity as a versioned AES-GCM payload and maintains a stable installation ID.
- Secure QR/App-Link pairing requires a valid HTTPS domain on standard port 443, uses pairing protocol v2, binds exchange to the installation ID, and consumes each token once.
- The default highest-administrator login is `13900000000`. Leaving the password blank generates a unique random temporary password and forces a password change after login.
- `sudo db` displays installation information or resets the highest-administrator login and password.

## Install on Ubuntu/Debian VPS

Download the installer before running it as root:

```bash
(
  set -e
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT
  curl -fL --retry 3 -o "$tmp" \
    'https://raw.githubusercontent.com/yongwei9527-art/IDBS/v5.0.8/scripts/install.sh'
  sudo env BRANCH=v5.0.8 bash "$tmp"
)
```

During installation you may enter a domain, a public IPv4 address, or leave the address blank for automatic IPv4 detection. DNS and inbound TCP 80/443 must be configured outside the installer. Without a domain, use the printed `http://SERVER_IP/v5/` URL and configure the Android App manually instead of using QR pairing.

After installation:

```bash
sudo db
sudo systemctl status laboratory-management-system --no-pager
```

The full deployment, update, backup, and uninstall guide is in [VPS_DEPLOYMENT.md](./VPS_DEPLOYMENT.md).

## Update an existing VPS

To follow the release tag explicitly:

```bash
sudo env RELEASE_REF=v5.0.8 laboratory-management-system-update
```

The updater verifies a database backup before migration. If the candidate fails readiness checks, it switches application code back when a previous release exists, but it never restores the database automatically.

## Android installation

Download `Laboratory-Management-System-v5.0.8.apk` from the GitHub Release assets, verify it with `SHA256SUMS-v5.0.8.txt`, and install it through Android's package installer. Existing users of an official APK signed with the same production certificate can install it as an update.

Release assets produced by the signed workflow:

- `Laboratory-Management-System-v5.0.8.apk`
- `Laboratory-Management-System-v5.0.8.aab`
- `SHA256SUMS-v5.0.8.txt`

Do not upload Android signing keys, `keystore.properties`, Firebase service-account JSON, `.env`, database dumps, or temporary administrator credentials to GitHub.

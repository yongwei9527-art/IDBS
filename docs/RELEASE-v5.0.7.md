# IDBS v5.0.7

v5.0.7 completes the Firebase Cloud Messaging deployment chain while preserving the secure server-pairing and VPS installation features introduced in v5.0.6.

## Highlights

- Android package: `com.laboratory.managementsystem`
- Android `versionCode`: `50007`
- Signed with the same production certificate as v5.0.5 and v5.0.6, so official builds can upgrade in place.
- The release workflow now restores the validated Firebase Android client configuration from GitHub Actions Secrets.
- VPS installation can optionally validate and configure a Firebase Admin SDK service-account file.
- Existing VPS deployments can add or rotate Firebase credentials with the root-owned `laboratory-management-system-configure-firebase` command.
- Server configuration prefers `FCM_SERVICE_ACCOUNT_JSON_BASE64`, avoiding multiline private-key corruption in `.env` files; legacy raw JSON remains compatible.

## Android installation

Download `Laboratory-Management-System-v5.0.7.apk` from this release and install it on Android. Users who installed an official v5.0.5 or v5.0.6 APK can install it directly as an update.

Debug-signed packages are a separate signing track and cannot be upgraded directly to the production-signed APK.

After installation:

1. Open the server download page at `https://<your-domain>/download`.
2. Scan the short-lived server pairing QR code in the App, or enter the HTTPS server address manually.
3. Sign in with the user's own account and password.
4. Open notifications and grant Android notification permission to register the FCM device token.

The QR code and APK never contain administrator credentials, database passwords, JWT secrets, Firebase Admin private keys, or Android signing keys.

## New VPS installation

```bash
curl -fsSL https://raw.githubusercontent.com/yongwei9527-art/IDBS/v5.0.7/scripts/install.sh | sudo env BRANCH=v5.0.7 bash
```

The installer asks whether Firebase Android push should be configured. If enabled, provide an absolute path to the Firebase Admin SDK service-account JSON already uploaded to the VPS. The installer validates it without printing its contents and stores only Base64-encoded compact JSON in the root-readable deployment environment.

## Enable or rotate Firebase on an existing VPS

Upload the service-account JSON temporarily, then run:

```bash
sudo /usr/local/sbin/laboratory-management-system-configure-firebase /root/firebase-admin-service-account.json
```

The root-owned command validates the credential and private-key structure, updates `FCM_SERVICE_ACCOUNT_JSON_BASE64` without exposing it in process arguments, restarts the service, and retries `/ready` for up to 30 seconds. A failed restart or readiness check restores the previous configuration. Send one administrator test notification afterward to verify Firebase IAM and outbound connectivity, then securely remove the temporary source JSON after creating an encrypted offline backup.

Do not paste service-account JSON directly into shell history and do not upload it to GitHub Releases.

## Update and backup

```bash
cd /var/www/laboratory-management-system-src
sudo bash scripts/backup.sh
sudo bash scripts/update.sh
```

The update path preserves the shared `.env`, uploads, exports, PostgreSQL data, and backups.

## Release verification

The release contains:

- `Laboratory-Management-System-v5.0.7.apk`
- `Laboratory-Management-System-v5.0.7.aab`
- `SHA256SUMS-v5.0.7.txt`

Verify downloads with:

```bash
sha256sum -c SHA256SUMS-v5.0.7.txt
```

## Credential safety

Never commit or publish:

- `.env` files;
- `google-services.json`;
- Firebase Admin SDK service-account JSON;
- Android keystores or signing passwords;
- database backups, exports, uploads, or administrator passwords.

The Android client configuration is restored only from `ANDROID_GOOGLE_SERVICES_JSON_BASE64`. The Firebase Admin credential belongs only on the VPS deployment and encrypted administrative backups.

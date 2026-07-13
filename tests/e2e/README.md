# IDBS 5.0 E2E Test Plan

Current Playwright coverage:

- Login page, token-based user and administrator access, and unauthenticated redirects.
- Device catalogue, reservation, calendar, borrow records, fault reports, notifications, and chat pages.
- Administrator dashboard, devices, reservations, users, requests, system, and audit pages.
- Desktop Chromium and Pixel 5 mobile layouts.
- REST health, readiness, public-device, and protected-endpoint compatibility checks.

The canonical production paths are `/v5/` and `/api/v5`; no legacy compatibility routes are served.

## Recommended: isolated E2E runner

Use the guarded runner for local regression. It requires a dedicated PostgreSQL database whose name contains `e2e`, rebuilds `public/v5`, optionally prepares and seeds **only that database**, starts a temporary local server, runs Playwright, and shuts the server down.

```powershell
Copy-Item e2e.env.example .env.e2e
# Edit .env.e2e and set a dedicated idbs_e2e connection string.
Get-Content .env.e2e | ForEach-Object {
  if ($_ -match '^(?<key>[^#=]+)=(?<value>.*)$') {
    Set-Item -Path "Env:$($matches.key.Trim())" -Value $matches.value
  }
}
node scripts/run-isolated-e2e.js
```

Or set the required value directly:

```powershell
$env:E2E_DATABASE_URL = 'postgresql://idbs_user:your-password@127.0.0.1:55432/idbs_e2e'
node scripts/run-isolated-e2e.js
```

Safety rules enforced by the runner:

- `DATABASE_URL` is never used as a fallback test target.
- Database names not explicitly marked with `e2e` are rejected.
- Only `localhost` or `127.0.0.1` using `E2E_PORT` (default `3100`) can be the test URL.
- The test server has temporary, test-only rate-limit values; production limits are not changed.
- Test uploads are kept in `.idbs-runtime/e2e-uploads`.

Set `E2E_PREPARE=false` only when the isolated database has already been initialized and seeded. Set `E2E_BUILD=false` only when the built React assets are known to be current.

## Existing-server mode

`npm run e2e` runs Playwright against `E2E_BASE_URL` (or `SMOKE_BASE_URL`). Use it only for an already-running isolated test server that hosts the built `public/v5` application. Do not point it at a production, shared, or personal development database.
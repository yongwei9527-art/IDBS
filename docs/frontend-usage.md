# IDBS 5.0 Frontend Guide

## Current frontend and paths

IDBS **5.0.0** uses the React + TypeScript frontend in `web/`. Its production
bundle is written to `public/v5/` and the application is served at `/v5/`.
`/v5/` is a stable deployment path retained for compatibility, not a statement
that the product is version 3.

The frontend API base is `/api/v5`. The complete request, authentication, and
WebSocket contract is [v5-api-contract.md](./v5-api-contract.md). New screens
must not introduce calls to the legacy `/api/*` routes.

## Local development

```bash
cd web
npm run dev
```

Run the Express backend separately with a PostgreSQL database. The Vite
configuration proxies API requests during development. Build the production
frontend from the repository root with `npm run build`, or from `web/` with
`npm run build`.

## Authentication and realtime

Store only the access token in the application session. Refresh uses the
HttpOnly cookie at `/api/v5/auth/refresh`; do not read, persist, or send a
refresh token from frontend JavaScript. Send `Authorization: Bearer
<access-token>` for protected calls.

For realtime updates, connect to `WS /api/v5/ws`, send the authentication first
frame within 10 seconds, then resubscribe after reconnect. Do not put the JWT
in the WebSocket URL.

## Route and UX rules

Keep application routes under `/v5/`, and preserve legacy entry redirects
implemented by the backend. Enforce permission-based navigation for usability,
but always rely on server-side authorization as the security boundary. Display
API errors using the common error wrapper rather than assuming a successful
payload shape.

## Verification

```bash
npm run v5:typecheck
npm run build
npm run e2e:isolated
```

Before release, also run `npm run v5:quality` from the repository root. The
permission and click audits cover the built 5.0 React application.

# IDBS 5.0 Backend Operations Guide

## Release contract

IDBS **5.0.0** is the current release. The React application is served at
`/v5/` and its stable API prefix is `/api/v5`; the path names remain for
backward-compatible deployment and do not identify the product release.

- Canonical 5.0 endpoint catalog: [v5-api-contract.md](./v5-api-contract.md)
- Legacy `/api/*` compatibility endpoints: [api-contract.md](./api-contract.md)
- Release acceptance baseline: [v5-release.md](./v5-release.md)

New backend consumers must use `/api/v5`. Do not add new features only to the
legacy `/api/*` router.

## Runtime and configuration

The service runs on Node.js, Express, and PostgreSQL. Set `DATABASE_URL`, a
strong `TOKEN_SECRET`, `ADMIN_PASSWORD`, `CORS_ORIGIN`, and production-safe
rate-limit values before deployment. Behind Nginx, set `TRUST_PROXY=true`.

```bash
npm ci
npm run db:migrate
npm run build
NODE_ENV=production npm start
```

For a fresh local database, use `npm run db:setup-local`; for a demonstration
dataset, use `npm run db:seed-demo`. Never use a destructive reset command on
production data without a verified backup.

## Health, readiness, upload, and WeChat

- `GET /health` is liveness only and remains `200` if PostgreSQL is down.
- `GET /ready` is readiness and returns `503` when database or required
  configuration is unavailable.
- `POST /api/upload` accepts multipart field `file`; it remains a shared upload
  endpoint and is documented in the 5.0 contract.
- `GET /wechat` and `POST /wechat` are the WeChat public-account callback.

## API implementation rules

V5 handlers are in `src/routes/v5/`. They return the unified wrapper
`{ code: 0, data, message }`; failures use the documented error wrapper or
RFC 7807 representation. Protect non-public routes with server-side
`requireAuth` and permission middleware. Access and refresh tokens must never
be logged or placed in URL query strings.

Whenever a route is added, changed, or removed, update
`docs/v5-api-contract.md` in the same change. `npm run check` enforces that
all declared V5 HTTP routes are present in the contract.

## Verification before release

```bash
npm run doctor
npm run v5:quality
npm run v5:selftest
npm run v5:permission-audit
npm run v5:click-audit
```

Use `npm run e2e:isolated` with `E2E_DATABASE_URL` pointing to a database named, for example, `idbs_e2e`. The runner rejects non-E2E database names and starts its own temporary server. Verify `/health`
and `/ready` separately because they intentionally have different semantics.

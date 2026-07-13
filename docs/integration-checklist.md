# IDBS 5.0 Integration Checklist

Use this checklist for every IDBS **5.0.0** integration. The canonical client
contract is [v5-api-contract.md](./v5-api-contract.md). `/api/v5` and `/v5/`
are stable compatibility paths; they are the required paths for new clients.

## Environment

- [ ] PostgreSQL is reachable through `DATABASE_URL` and schema migrations have run.
- [ ] `TOKEN_SECRET` is at least 32 random characters.
- [ ] `ADMIN_PASSWORD` is strong and is not a placeholder.
- [ ] `CORS_ORIGIN` lists the real frontend origins; production does not use `*`.
- [ ] Nginx deployments set `TRUST_PROXY=true`, preserve WebSocket upgrade headers,
  and serve HTTPS.
- [ ] Upload storage is writable and is exposed only through `/uploads`.

## API and authentication

- [ ] New calls use `/api/v5`, not the legacy `/api/*` compatibility router.
- [ ] Protected calls send `Authorization: Bearer <access-token>`.
- [ ] Refresh uses the `idbs.refresh_token` HttpOnly cookie via
  `POST /api/v5/auth/refresh`; the refresh token is never read from JavaScript,
  passed in a URL, or written to logs.
- [ ] The integration handles `401`, `403`, `409`, `422`, `429`, and `5xx` from
  the standard V5 error response.
- [ ] Any route addition updates `docs/v5-api-contract.md` and passes
  `npm run check`.

## Realtime and callbacks

- [ ] The client connects to `WS /api/v5/ws` without a query token.
- [ ] The first WebSocket frame authenticates within 10 seconds; reconnects
  authenticate and subscribe again.
- [ ] Chat subscriptions are only attempted for conversations available to the
  current user.
- [ ] WeChat callbacks use `GET /wechat` and `POST /wechat`.

## Release verification

- [ ] `npm run doctor` passes against the target environment.
- [ ] `npm run v5:quality` passes.
- [ ] `npm run v5:selftest`, `npm run v5:permission-audit`, and
  `npm run v5:click-audit` pass against the deployed application.
- [ ] `GET /health` returns `200`; `GET /ready` returns `200` after database
  readiness is confirmed.
- [ ] Restore and rollback procedures have been rehearsed with a backup.

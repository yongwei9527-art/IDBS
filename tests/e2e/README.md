# IDBS 2.0 E2E Test Plan

Planned Playwright coverage:

- `login.spec.js`: user login, admin login, expired session handling
- `user-reservation.spec.js`: multi-device/date/slot reservation flow
- `admin-approval.spec.js`: batch approval and item approval
- `borrow-return.spec.js`: start use, return with photo, abnormal return
- `fault-report.spec.js`: submit and resolve fault report
- `chat.spec.js`: direct chat, group chat, unread state, context card
- `mobile-layout.spec.js`: mobile tab navigation and key pages
- Current starter specs:
	- `smoke-flow.spec.js`
	- `reservation-flow.spec.js`
	- `admin-flow.spec.js`
	- `chat-fault-mobile.spec.js`

Admin detail drawers are covered by `admin-flow.spec.js`.

Run target:

```bash
npm run e2e
```

The suite must use a fresh IDBS 2.0 demo database created from `sql/schema.sql` and `scripts/seed-demo-data.js`.

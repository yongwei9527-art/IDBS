# Auth Domain

Planned scope for staged extraction from `create-rental-service.js`:

- user password login
- admin password login
- WeChat challenge creation and polling
- first-time WeChat binding
- token creation and verification helpers
- login activity logging integration

Current phase keeps the public `createRentalService()` API stable while low-risk helpers move to `src/services/core/`.

Extracted now:

- `auth-service.js`: admin password login, user password login and disabled password-registration response.

Still in `create-rental-service.js`:

- WeChat challenge creation and polling
- first-time WeChat binding
- WeChat code scan handling
- shared `requireUser` / `requireAdminRole` guards used by other domains

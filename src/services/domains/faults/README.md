# Faults and Requests Domain

Planned scope for staged extraction from `create-rental-service.js`:

- device fault reporting
- admin fault review and device recovery linkage
- user request lifecycle
- admin request review
- request status normalization

Extracted now:

- `fault-request-service.js`: user fault reports, admin fault handling, user request CRUD/change flow and admin request review.

Still in `create-rental-service.js`:

- borrow/return abnormal handling that may create or affect fault state
- device recovery helpers shared with reservations and notifications

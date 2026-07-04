# Reservations Domain

Staged extraction from `create-rental-service.js`:

- `reservation-read-service.js`: calendar events/day view, user reservation batch list/detail, admin reservation list, admin batch list/detail.
- `reservation-action-service.js`: reservation precheck, creation, user cancellation, item cancellation bridge, admin item/batch approval.
- `borrow-return-service.js`: reservation usage start, borrow record creation, return submission, abnormal return state transition.

Remaining scope:

- reservation payload normalization
- reservation notifications and usage log integration

Extraction must be conservative because reservation logic touches device status, notifications, usage logs and database exclusion constraints.

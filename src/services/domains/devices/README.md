# Devices Domain

Planned scope for staged extraction from `create-rental-service.js`:

- public device list and detail
- reservation slot options bound to devices
- device time-slot queries
- admin device list, create, update and detail
- device state transition helpers
- device-related fault summaries

Extraction order:

1. pure slot normalization helpers
2. public read-only queries
3. admin write operations
4. device state transitions used by reservations and returns

Keep route-level method names stable during migration.

Extracted now:

- `device-read-service.js`: public device list, device detail, reservation slot options, device time-slot query and admin device list.

Still in `create-rental-service.js`:

- device create/update
- device status transition
- device fault-state linkage used by return and fault workflows

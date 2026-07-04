# Reports Domain

Planned scope for staged extraction from `create-rental-service.js`:

- usage statistics
- CSV and Excel exports
- daily usage report preview
- WeChat daily report push orchestration

Report extraction should keep query outputs compatible with existing admin pages.

Extracted now:

- `export-service.js`: export job creation, listing, CSV file generation and pending-job execution.

Still in `create-rental-service.js`:

- synchronous export query assembly
- usage statistics
- analytics overview/device/fault/time-heatmap queries
- daily usage report preview and WeChat push orchestration

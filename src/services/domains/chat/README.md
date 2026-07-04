# Chat Domain

Staged extraction from `create-rental-service.js`:

- `chat-service.js`: chat users and conversations, participants and group management, message normalization/sending, SSE client registry and event publishing, management group bootstrap and cleanup.

SSE state remains process-local inside `chat-service.js`. Multi-instance deployment still requires Redis Pub/Sub or database notifications.

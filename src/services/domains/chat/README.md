# Chat Domain

Staged extraction from `create-rental-service.js`:

- `chat-service.js`: chat users and conversations, participants and group management, message normalization/sending, WebSocket/SSE event publishing, realtime principal resolution, management group bootstrap and cleanup.

Realtime events are fanned out between instances through PostgreSQL `LISTEN/NOTIFY`; SSE remains only as a transition-compatible process-local endpoint.

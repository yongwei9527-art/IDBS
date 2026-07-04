# WeChat Domain

Staged extraction from `create-rental-service.js`:

- `wechat-service.js`: official-account signature/handshake, text callback handling, XML reply helper, challenge-code login, account binding.
- `wechat-push-service.js`: outbound customer-service text messages, daily usage report building/sending, push log recording.

Remaining scope:

- none for current WeChat domain; keep future platform-specific features here.

Production secrets must continue to come from runtime config or system config, not hardcoded files.

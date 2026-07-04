# Service Core

This directory contains low-risk shared service utilities and context helpers used by domain services.

Migration rule: keep `createRentalService()` backward compatible while moving pure helpers here first.

Current extracted helpers:

- `service-utils.js`: REST result helpers, safe URL/filename handling, boolean parsing.
- `validation.js`: phone, password, email and text validation.
- `crypto-utils.js`: password hashing and token helpers.
- `date-time.js`: duration and timezone formatting.
- `chat-utils.js`: chat metadata cleanup, attachment normalization and context-card relation helpers.
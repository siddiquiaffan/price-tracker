# ADR 0004 — API key guard on all routes but `/bot`, plus `/healthz`

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

The legacy Express API only checks `API_KEY` on `/info` (bug B3); `GET/POST/DELETE /` and `/stats`
are unauthenticated. `API_KEY` is clearly intended to protect the whole API.

## Decision

- Apply a Bearer-token guard (`Authorization: Bearer <API_KEY>`) to **every** API route except the
  Telegram webhook `/bot` (the webhook is authenticated by Telegram itself via the secret token).
  Wrong/missing keys return `401 { error: "Invalid API key" }` (assumption A1).
- Add a **new** `GET /healthz` liveness endpoint that deliberately requires **no** auth and returns
  `{ ok: true }`, so Docker orchestration and the CI smoke test can probe the process (assumption A9).
- The `DELETE /` route now requires both `tracking_id` and `userId` (fixes the legacy truthiness bug
  B21), returning `503 { error: "Either tracking_id or userId is incorrect/missing." }` otherwise.

## Consequences

- The API is safe to expose publicly with a strong `API_KEY`.
- Existing integrations that called the now-guarded endpoints must add the bearer header — a
  documented breaking change (see `docs/MIGRATION_NOTES.md`, §5 A1).
- `/healthz` is intentionally outside the guard (liveness must not depend on credentials).
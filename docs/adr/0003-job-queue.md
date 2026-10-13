# ADR 0003 — `JobQueue` port: BullMQ + in-memory adapter

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

The legacy bot re-checks every tracked product hourly via `setInterval` in a single process (bug
B10: two instances run the loop concurrently — no lock, no dedupe, no jitter). The rewrite must be
multi-instance-safe and testable offline.

## Decision

Introduce a `JobQueue` port with two adapters:

- **`BullMqJobQueue`** — BullMQ + Redis, used in production when `REDIS_URL` is set.
- **`InMemoryJobQueue`** — deterministic in-memory adapter used in dev/tests and when `REDIS_URL`
  is absent.

Dedup rules:

- **Cross-instance:** a stable job id per `check:<storeId>:<productId>` means only one worker
  processes a given product at a time (BullMQ's job dedup by id across instances).
- **In-process:** a `KeyedMutex` serializes concurrent processing of the same product within one
  process.
- The scheduler enqueues one jittered job per product per interval (`SCHEDULE_INTERVAL_MS` +
  `SCHEDULE_JITTER_RATIO`).

## Consequences

- Multi-instance-safe scheduling is proven offline with the in-memory adapter.
- Tests assert enqueue-once-per-interval, jitter bounds, and no two workers on one product.
- Redis becomes optional infrastructure rather than a hard dependency.
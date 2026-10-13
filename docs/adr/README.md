# Architecture Decision Records

This directory records the significant architectural decisions made during the TypeScript rewrite
of `price-tracker`. Each ADR is short, self-contained and reproducible.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-rewrite-to-typescript.md) | Rewrite to strict TypeScript with pluggable ports | Accepted |
| [0002](0002-pluggable-egress.md) | Pluggable egress (proxy) layer with legacy shim | Accepted |
| [0003](0003-job-queue.md) | `JobQueue` port: BullMQ + in-memory adapter | Accepted |
| [0004](0004-api-auth-and-healthz.md) | API key guard on all routes but `/bot`, plus `/healthz` | Accepted |
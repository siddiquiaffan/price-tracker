# ADR 0001 — Rewrite to strict TypeScript with pluggable ports

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

The legacy bot is flat JavaScript (`index.js`, `bot.js`, `config.js`, `db.js`, `utils.js`,
`unshort.js`, `worker.js`) with a single MongoDB database (`AS_TRACKER`), Express, and a
`setInterval` re-check loop. It is hard to extend (only two hardcoded stores), has no type safety,
and couples scraping, proxying, storage and the scheduler together.

## Decision

Rewrite the application in TypeScript while preserving every observable legacy behaviour (see
`docs/MIGRATION_NOTES.md` for the exact strings, API shapes and DB schema):

- TypeScript with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`; ESM output; Node 22+; pnpm.
- Hexagonal layout: `src/core` holds use cases + ports (no I/O libraries), enforced by an ESLint
  import-boundary rule and a madge circular-dependency check.
- Infrastructure plugs in: `mongodb` driver behind hand-written repositories, pino logging,
  Hono HTTP, grammY Telegram, Zod-validated config as the only module allowed to read `process.env`.
- Stores (Amazon / Flipkart / future) and egress providers are pluggable behind ports; adding a
  third store or a new provider type is a localized change.
- Keep the legacy JS on a branch until the parity test suite passes, then remove it (Phase 11).

## Consequences

- Behavioural parity is testable offline with fixtures and fakes.
- Adding stores or egress providers no longer requires touching the core.
- The strict compiler flags caught numerous latent bugs during the migration (documented as B1–B25).
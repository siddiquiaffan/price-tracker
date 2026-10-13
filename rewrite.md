# Prompt: Rewrite `siddiquiaffan/price-tracker` in TypeScript (pluggable stores + pluggable proxies)

Copy everything below the line into your AI coding agent (Claude Code or similar), with the repo cloned or accessible.

---

## Task

Rewrite the JavaScript project at https://github.com/siddiquiaffan/price-tracker in **TypeScript** with better readability, maintainability and scalability, using current best practices. The new implementation must be **pluggable**: new e-commerce stores and new proxy/egress providers must be addable without touching core logic. Use classes where state or injection is needed.

## Context: what the project is today

A Telegram bot plus HTTP API that tracks Amazon and Flipkart product prices and notifies users when prices change. Flat JavaScript structure:

`index.js, bot.js, config.js, db.js, utils.js, unshort.js, worker.js` (Cloudflare Worker used as a scraping proxy), plus `Dockerfile`, `Procfile`, `app.json` (Heroku), `.github/`. License: GPL-3.0.

Behaviour that must be preserved:

- Bot commands: `/start`, `/help`, `/track <link>`, `/stop <trackingId>`, `/list`, and an admin broadcast.
- API protected by `API_KEY`; per-user tracking cap via `LIMIT`; admins via `ADMINS`.
- Env vars: `BOT_TOKEN, DB_URL (MongoDB), WORKER_URL, PROXY, API_KEY, LIMIT, ADMINS`.
- Short-link resolution (`unshort.js`) before store detection.
- Webhook setup endpoint at `/setup`.
- Scraping goes through a Cloudflare Worker and/or an HTTPS proxy to avoid IP blocks.
- Notification on every price change.

## Step 0: Read before writing

Read every file in the repo end to end. Then write `docs/MIGRATION_NOTES.md` covering:

1. The actual data flow (command → scrape → persist → notify → scheduled re-check).
2. Existing bugs, race conditions, duplicated code, hardcoded values, missing error handling.
3. Every implicit behaviour to preserve (message formats, DB schema, API response shapes).

Do not write code until this is done. If something is ambiguous, record your assumption in the notes instead of silently choosing.

## Goals

Readability, maintainability, scalability, pluggability. Specifically:

- Adding a new store (Snapdeal, Myntra, Croma, ...) requires one new folder and one registration line, with zero edits to core logic (open/closed principle).
- Adding a new proxy provider type requires one new file and one registration line; adding or removing a proxy instance requires only a config change.

## Target stack and standards

- **TypeScript** latest stable, `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`. ESM modules. Node LTS (22+).
- Package manager: pnpm. Build with `tsc`; dev with `tsx`.
- Lint and format: ESLint (flat config, typescript-eslint strict) + Prettier. Husky + lint-staged pre-commit.
- Testing: Vitest. Unit tests for parsers and services; integration tests for repositories (`mongodb-memory-server`); shared contract tests that every store plugin and every egress provider must pass.
- Env validation: **Zod**, fail fast at startup with readable errors. No `process.env` access outside the config module.
- Logging: **pino**, structured, with request/job correlation IDs. No `console.log`.
- HTTP server: Fastify (or Hono) with schema-validated routes. Telegram: grammY (or Telegraf v4) in webhook mode, long-polling option for local dev.
- Database: keep MongoDB with the official driver or Mongoose, typed models, indexes defined in code, a repository layer. The domain layer must not import the DB library.
- HTTP: undici/native `fetch` with timeouts and `AbortController`. All outbound scraping traffic goes through the `EgressPool` (below), never a bare `fetch`.
- Scheduling and scale: replace ad-hoc timers with a job queue (BullMQ + Redis, behind a `JobQueue` interface, with an in-memory adapter for dev/tests). Use concurrency limits, per-domain rate limiting and jittered re-check intervals. It must be safe with multiple instances (no duplicate price checks; use locks or queue semantics).

## Architecture (hexagonal / ports-and-adapters, lightweight, no over-engineering)

```
src/
  config/                  # zod env schema, typed config object, egress config loader
  core/                    # domain: pure TS, no I/O
    entities/              # Product, PriceSnapshot, Tracking, User, Money
    errors/                # AppError hierarchy (ScrapeError, ParseError, LimitExceededError,
                           #   UnsupportedStoreError, AllEgressFailedError, ...)
    ports/                 # ProductRepository, TrackingRepository, Notifier, JobQueue, Fetcher, Clock
    services/              # TrackingService, PriceCheckService, StoreResolver, UrlResolver
  stores/                  # STORE PLUGIN SYSTEM
    store.interface.ts
    base-store.ts          # abstract class, template method
    registry.ts            # StoreRegistry: register(), resolve(url)
    amazon/                # AmazonStore + selectors.ts + parser + fixtures
    flipkart/              # FlipkartStore + selectors.ts + parser + fixtures
    index.ts               # the only place stores are registered
  infra/
    db/                    # Mongo client, repositories, migrations
    http/
      fetcher.ts           # Fetcher port implementation; delegates to EgressPool
      decorators/          # retry, rate-limit, timeout, circuit-breaker (composable wrappers)
    egress/                # PROXY / EGRESS PLUGIN SYSTEM
      egress-provider.interface.ts
      provider-registry.ts # register(), create(config)
      egress-pool.ts       # selection, rotation, failover, health tracking
      block-detector.ts    # per-store captcha/blocked-page detection
      strategies/          # round-robin, random, weighted, least-used, sticky-session
      providers/
        direct.provider.ts
        http-proxy.provider.ts
        socks-proxy.provider.ts
        cloudflare-worker.provider.ts
        unlocker-api.provider.ts   # generic gateway APIs (ScraperAPI, ZenRows, Bright Data Unlocker, ...)
      index.ts             # the only place providers are registered
    queue/                 # BullMQ adapter + in-memory adapter
    notifier/              # TelegramNotifier
  interfaces/
    telegram/              # bot setup, one file per command handler, middlewares (auth, limit, error)
    api/                   # routes, auth hook, request/response schemas
  app.ts                   # composition root (manual DI, or awilix/tsyringe if justified)
  main.ts                  # entrypoint, graceful shutdown (SIGTERM), health endpoints
worker/                    # ported Cloudflare Worker (TypeScript, wrangler)
docs/                      # MIGRATION_NOTES.md, ADRs, ADDING_A_STORE.md, ADDING_A_PROXY_PROVIDER.md
```

### Class vs function guidance

Use classes for stateful or injectable things (stores, repositories, services, fetchers, providers, notifier). Use plain functions for pure logic (parsers, formatters, money math). Prefer composition and constructor injection over inheritance, except for `BaseStore`. No singletons or module-level mutable state.

## Pluggable stores

```ts
export interface Store {
  readonly id: string; // 'amazon'
  readonly name: string;
  readonly hosts: readonly string[]; // ['amazon.in', 'amzn.in', ...]
  matches(url: URL): boolean;
  normalizeUrl(url: URL): URL; // strip tracking params, canonical product URL
  extractProductId(url: URL): string;
  fetchProduct(url: URL, ctx: ScrapeContext): Promise<ProductData>;
}
```

- `BaseStore` (abstract class) implements the shared pipeline as a template method: normalize → fetch (via injected `Fetcher`) → block-detect → parse → validate (Zod) → return `ProductData`. Subclasses implement only `parse(html)` and selectors.
- Parsing is a **pure function of HTML**, tested against saved HTML fixtures. Prefer JSON-LD/structured data, then fall back to CSS selectors via `cheerio`. Keep selectors in a per-store `selectors.ts`.
- Money: store prices as integer minor units plus currency code, never floats. Provide a `Money` value object.
- `StoreRegistry` resolves a URL (after short-link expansion) to a store, or throws `UnsupportedStoreError` with a helpful user-facing message.
- `UrlResolver` expands short links with a redirect limit and **SSRF protection** (block private IP ranges and non-http(s) schemes).
- Write `docs/ADDING_A_STORE.md` with a step-by-step guide and a template store.

## Pluggable proxy / egress layer

The current code hardcodes one HTTPS proxy (`PROXY`) and one Cloudflare Worker (`WORKER_URL`). Replace both with a provider-based system so any number and mix of proxies can be configured, rotated and swapped without touching store or service code. Stores never know which proxy is used; they only call the `Fetcher` port.

### Two kinds of egress, one contract

1. **Connection proxies** (HTTP, HTTPS, SOCKS4/5): the request goes to the target site through a proxy.
2. **Gateway/unblocker services** (Cloudflare Worker, ScraperAPI, ZenRows, Bright Data, your own relay): you call the gateway with the target URL and it returns the page.

```ts
export interface EgressProvider {
  readonly id: string; // unique instance id, e.g. 'proxy-in-1'
  readonly type: string; // 'http-proxy' | 'socks' | 'cloudflare-worker' | 'direct' | ...
  readonly capabilities: {
    jsRendering?: boolean;
    geo?: string[]; // ['IN', 'US']
    stickySessions?: boolean;
  };
  request(
    req: EgressRequest,
    opts?: { signal?: AbortSignal; sessionId?: string },
  ): Promise<EgressResponse>;
  healthCheck?(): Promise<boolean>;
  close?(): Promise<void>;
}

export interface EgressRequest {
  url: URL;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}
export interface EgressResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  providerId: string;
  latencyMs: number;
}
```

Implementations (each a class built through a factory registered in `ProviderRegistry`):

- `DirectProvider` (no proxy; dev and tests)
- `HttpProxyProvider` using undici `ProxyAgent`, with auth support
- `SocksProxyProvider` using `socks-proxy-agent`
- `CloudflareWorkerProvider` (the ported worker with a typed request/response contract shared with `/worker`)
- `UnlockerApiProvider`: a configurable generic gateway adapter (endpoint template, auth header, param mapping) so new services need config rather than code

### Pool, rotation and health

`EgressPool` owns the provider instances and is the only thing the `Fetcher` talks to:

- **Selection strategies** as pluggable `SelectionStrategy` classes: `RoundRobin`, `Random`, `Weighted`, `LeastUsed`, `StickySession`.
- **Failure-aware:** track success/failure per provider (and per provider + store). After repeated failures (timeouts, 403/429, captcha pages), put the provider in cooldown with exponential backoff and return it to rotation after a successful health check.
- **Failover:** on a retryable error, retry on a _different_ provider (never the same one twice in a row), up to a configurable max. Throw `AllEgressFailedError` only when exhausted.
- **Block detection:** a pluggable per-store `BlockDetector` inspects status and body (captcha, robot check, missing price) and tells the pool to penalise that provider.
- **Per-store routing policy:** `storeId → poolName`, with a default pool.
- **Named pools** (e.g. `residential`, `datacenter`, `gateway`), each with its own strategy and providers.

### Configuration (no code change to add or remove a proxy)

Load from a validated config file (`egress.config.json`/YAML) or an `EGRESS_CONFIG` env var holding JSON, validated with Zod using a discriminated union on `type`. Support `${ENV_VAR}` interpolation so secrets stay out of the file. Keep a back-compat shim: if only legacy `PROXY` and `WORKER_URL` are set, auto-generate an equivalent config so existing deployments keep working.

```jsonc
{
  "pools": {
    "default": {
      "strategy": "weighted",
      "providers": [
        {
          "id": "res-in-1",
          "type": "http-proxy",
          "url": "http://user:pass@host:8000",
          "weight": 3,
          "geo": ["IN"],
        },
        { "id": "socks-1", "type": "socks", "url": "socks5://user:pass@host:1080", "weight": 1 },
        {
          "id": "cf-worker",
          "type": "cloudflare-worker",
          "url": "https://x.workers.dev",
          "secret": "${CF_SECRET}",
        },
      ],
      "cooldown": { "baseMs": 30000, "maxMs": 600000 },
      "maxAttempts": 3,
    },
  },
  "storePolicy": { "amazon": "default", "flipkart": "default" },
}
```

### Egress requirements

- **Security:** redact proxy credentials in all logs, errors and metrics (log `providerId`, never the URL with auth). Keep the SSRF guard in front of the egress layer so a gateway can't be abused to hit internal addresses.
- **Observability:** per-provider metrics (requests, success rate, p50/p95 latency, cooldown state); include `providerId` in structured log context.
- **Testing:** a shared contract-test suite every `EgressProvider` must pass (local mock server); unit tests for each strategy, cooldown/failover logic and config validation; a test proving a store scrape succeeds after the first provider fails.
- **Lifecycle:** create providers in the composition root; close them on graceful shutdown (drain sockets and agents).
- **Docs:** `docs/ADDING_A_PROXY_PROVIDER.md` with a template provider and config example.

## Testing strategy and required test cases

Tests are a deliverable, not an afterthought. Write them alongside each module (tests first for parsers, money math and pool logic). Use Vitest; colocate unit tests as `*.test.ts` next to the code and put integration/e2e tests under `tests/`.

### Test layout and tooling

```
tests/
  fixtures/
    amazon/            # saved product HTML: in-stock, out-of-stock, deal price, no price, captcha page, JSON-LD variant
    flipkart/          # same variants
    egress/            # canned proxy/gateway responses
  helpers/             # builders, fake clock, in-memory repos, mock Telegram API, mock egress server
  integration/         # repositories (mongodb-memory-server), queue, API, Telegram flows
  e2e/                 # full track → scrape → change → notify flow with fakes
  contract/            # shared suites run against every Store and every EgressProvider
```

- Use `vi.useFakeTimers()` or an injected `Clock` for anything time-based (cooldowns, schedules, backoff). No real sleeps.
- Use `msw` or a local HTTP server for network mocks. **Tests must never hit real Amazon, Flipkart, Telegram or proxy services.**
- Use `supertest`/Fastify `inject()` for API tests; mock the Telegram Bot API at the HTTP level.
- Enforce coverage thresholds in `vitest.config.ts` (80% lines/branches on `core/`, `stores/`, `infra/egress/`) and fail CI below them.
- Tests must be deterministic and runnable in parallel; no shared mutable state, no order dependence.

### Required test cases

**Core: Money and entities**

- Parses `"₹1,29,999.00"`, `"$1,299.99"`, `"1299"` into the right minor units and currency; rejects garbage.
- Addition, comparison and percentage-drop calculations are exact (no float drift, e.g. 0.1 + 0.2 cases).
- Entity invariants: negative price rejected, empty product ID rejected.

**Core: services**

- `TrackingService.track`: creates a tracking for a valid URL; returns the existing one for a duplicate (idempotent); throws `LimitExceededError` at `LIMIT`; throws `UnsupportedStoreError` for an unknown host.
- `TrackingService.stop`: removes only the caller's own tracking; unknown ID gives a clean not-found error; another user's ID is rejected.
- `PriceCheckService`: no notification when the price is unchanged; one notification on a drop; one on a rise; none on scrape failure; stores a snapshot only on change; handles out-of-stock to in-stock transitions.
- Dedupe: running the same check twice concurrently produces one notification.
- Notification strategy: default notifies on every change (current behaviour); only-on-drop and threshold strategies behave correctly.

**Stores (contract suite run against every registered store)**

- `matches()` accepts all declared hosts and subdomains and rejects look-alike hosts (`amazon.in.evil.com`, `notamazon.in`).
- `normalizeUrl()` strips tracking params (`tag`, `ref`, `utm_*`, `pid` noise), is idempotent, and preserves the product identity.
- `extractProductId()` works for every URL shape (`/dp/`, `/gp/product/`, slug URLs, mobile URLs, short links after expansion) and throws `ParseError` for non-product pages.
- `parse()` against each fixture returns a schema-valid `ProductData` (title, price, currency, image, availability); out-of-stock, missing price and malformed HTML produce typed errors, not crashes or `NaN`.
- Block/captcha fixtures are detected by the `BlockDetector` and raise a block error that is retryable on another provider.
- Parsers are pure: same HTML in, same output out; no network access during parsing (assert with network blocked).
- Prefers JSON-LD when present and falls back to CSS selectors when it is absent or invalid.
- Adding a dummy third store in a test requires only its folder plus one registration call, and the suite passes against it.

**StoreRegistry / UrlResolver**

- Resolves the correct store per URL; throws `UnsupportedStoreError` with a user-safe message; rejects duplicate store IDs on registration.
- Short links expand correctly (`amzn.in`, `fkrt.it`), respecting the redirect limit and timeout.
- SSRF guard blocks `localhost`, `127.0.0.1`, `169.254.169.254`, RFC1918 ranges, IPv6 loopback, `file://`, `ftp://`, and redirects that land on a private address.

**Egress: provider contract suite (run against every provider)**

- Successful GET returns status, headers, body, `providerId` and `latencyMs`.
- Honours the abort signal and timeout; surfaces typed errors for connection refused, DNS failure, TLS error and non-2xx.
- Credentials never appear in thrown errors, logs or metrics (assert on serialized output).
- `close()` releases sockets/agents (no open handles after the test).
- Provider-specific: `HttpProxyProvider` sends proxy auth; `SocksProxyProvider` handles SOCKS5 auth; `CloudflareWorkerProvider` signs the request and parses the typed response; `UnlockerApiProvider` maps endpoint template, auth header and params from config.

**Egress: pool, strategies and config**

- `RoundRobin` cycles evenly; `Weighted` converges to configured ratios over many draws (seeded RNG); `LeastUsed` picks the least-loaded; `StickySession` returns the same provider for the same key.
- Failure handling: a provider enters cooldown after N failures, backoff grows exponentially up to the max, and it returns to rotation after a successful health check (use a fake clock).
- Failover: on a retryable error the retry goes to a _different_ provider; never the same provider twice in a row; stops at `maxAttempts` with `AllEgressFailedError` carrying per-provider failure reasons (without secrets).
- A 429/403/captcha body penalises the provider; a 404 on the product page does not.
- Per-store policy routes Amazon and Flipkart to their configured pools and falls back to the default pool.
- A store scrape succeeds end to end after the first provider fails.
- Config validation: a valid config loads; unknown `type`, missing URL, bad weight, duplicate IDs and unresolved `${ENV_VAR}` all fail with readable Zod errors; interpolation works; the legacy `PROXY`/`WORKER_URL` shim produces an equivalent config.
- Graceful shutdown closes every provider exactly once.

**Infra: repositories (mongodb-memory-server)**

- CRUD for products, trackings and users; unique indexes enforced (user + product); concurrent upserts do not duplicate.
- Migration runs idempotently twice with the same result; legacy-shaped documents still read correctly; rollback note verified on a sample.
- Queries use the intended indexes (assert via `explain()` for the hot paths).

**Infra: queue and scheduler**

- Jobs are enqueued once per product per interval; jitter stays within bounds; retries use backoff; permanently failing jobs go to a dead-letter path.
- Two workers never process the same product simultaneously (lock or queue semantics test).
- Per-domain rate limit and concurrency cap are respected under load.
- The in-memory and BullMQ adapters pass the same `JobQueue` contract suite.

**Interfaces: Telegram**

- Each command (`/start`, `/help`, `/track`, `/stop`, `/list`, admin broadcast) has a happy-path and failure-path test asserting the exact reply text.
- `/track` with no link, invalid link, unsupported store, duplicate, over-limit and blocked-scrape cases each give a clear, distinct message.
- Auth middleware: non-admins cannot broadcast; admin list parsing handles spaces and bad IDs.
- Webhook secret-token verification rejects requests with a missing or wrong token.
- Broadcast tolerates blocked users and Telegram rate limits without aborting the run.
- Unhandled errors produce a generic user message while the details go to logs.

**Interfaces: API**

- Missing or wrong `API_KEY` returns 401; comparison is constant-time (use `timingSafeEqual`).
- Request validation: bad bodies and params return 400 with schema errors; response shapes match the legacy API (snapshot or contract tests).
- Rate limiting returns 429 after the threshold; `/healthz` and `/readyz` report correctly, including when Mongo or Redis is down.

**Config and bootstrap**

- Missing or invalid required env vars fail startup with a readable message listing all problems at once.
- Secrets never appear in the logged config summary.
- `SIGTERM` triggers graceful shutdown: stops accepting work, drains the queue, closes providers and DB connections, then exits.

**End-to-end (all fakes, no real network)**

- Full flow: `/track <url>` → scrape via a fake provider → snapshot saved → simulated price drop → scheduled check → exactly one Telegram notification with the correct old/new price.
- Failure flow: the first provider is blocked, the second succeeds, and the user still gets the result.
- Limit flow: the user hits `LIMIT` and gets the limit message; `/stop` frees a slot.
- Legacy-config flow: the app boots with only `PROXY` and `WORKER_URL` set and tracks a product.

**Worker (`/worker`)**

- The request/response contract is validated with the shared types; an invalid secret gets 401; non-allowlisted hosts are refused; upstream errors are mapped to typed responses (test with `vitest-environment-miniflare` or `@cloudflare/vitest-pool-workers`).

**Static and structural checks (run in CI)**

- `tsc --noEmit` passes under strict settings; ESLint passes with zero warnings.
- `madge --circular` reports no cycles; an ESLint boundary rule proves `core/` never imports from `infra/`, `interfaces/` or any DB/HTTP library.
- Docker image builds and the container starts and answers `/healthz` (smoke test).

### Test quality rules

- Each test asserts behaviour, not implementation details; no snapshot-only tests for logic.
- Every bug found during the rewrite gets a regression test before the fix.
- Fixtures are real captured HTML with secrets and personal data stripped; record where each came from and the capture date in `tests/fixtures/README.md`.
- A flaky test is a failing test: fix it or delete it, never retry-until-green.

## Quality requirements

- **Error handling:** typed errors, no swallowed exceptions, a central error mapper for Telegram and the API. User-facing messages are separate from internal logs.
- **Resilience:** circuit breaker or backoff per store when a site starts blocking; clear "blocked/captcha detected" error; a scrape failure never crashes the process.
- **Security:** validate all input; constant-time API key comparison; no secrets in logs; Telegram webhook secret-token verification; API rate limiting; SSRF guard on user-supplied URLs.
- **Notifications:** dedupe so a price change notifies once. Add a strategy interface as an extension point (only-on-drop, threshold) with the default behaviour identical to today.
- **Idempotency and concurrency:** price checks are safe to run concurrently and retry.
- **Observability:** `/healthz` and `/readyz`; basic metrics hooks (prom-client optional).
- **Cloudflare Worker:** port `worker.js` to TypeScript (`wrangler`) in `/worker` with a typed contract shared with `CloudflareWorkerProvider`.
- **Docs:** README with Mermaid architecture diagram, setup, env table and deploy notes; ADRs for major decisions in `docs/adr/`.
- **CI:** GitHub Actions for typecheck, lint, test, build and Docker image build.
- **Docker:** multi-stage build, non-root user, `.dockerignore`; keep Heroku/Railway compatibility (`Procfile`, `app.json`) updated.
- **Licensing:** keep GPL-3.0 and attribution to the original author.

## Configuration summary

Env vars: `BOT_TOKEN, DB_URL, API_KEY, LIMIT, ADMINS, EGRESS_CONFIG` (file path or inline JSON). `PROXY` and `WORKER_URL` remain as deprecated legacy fallbacks that map into the egress config.

## Data migration

Keep existing MongoDB collections readable. If the schema changes (e.g. price to minor units), write an idempotent migration script with a rollback note. Never require a destructive migration.

## Working method

1. Write `docs/MIGRATION_NOTES.md` (Step 0).
2. Propose the final folder structure and key interfaces, then implement in small, reviewable commits in this order: tooling/config → core domain + ports → stores (Amazon first, then Flipkart) with fixture tests → egress layer (providers, pool, strategies, config) → other infra adapters → services → Telegram and API interfaces → queue/scheduler → worker port → Docker/CI → docs.
3. Every module ships with tests covering the cases listed in "Testing strategy and required test cases". Enforce at least 80% line and branch coverage on `core/`, `stores/` and `infra/egress/`.
4. After each phase run typecheck, lint and tests, and fix failures before moving on.
5. Do not invent selectors. Capture real HTML fixtures where possible; where live access is blocked, mark the selector as needing verification in the notes instead of guessing.
6. Avoid speculative abstractions. Every interface must have at least two implementations or a clear testing reason.

## Definition of done

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass, and `pnpm test:coverage` meets the thresholds.
- Every test case listed in "Testing strategy and required test cases" exists and passes; the store and egress contract suites run against every registered store and provider.
- No test touches the real network; the e2e suite passes fully offline.
- All existing bot commands and API behaviour work as before.
- Adding a dummy third store touches only its own folder and `stores/index.ts` (demonstrated by a test or example).
- Adding a new proxy provider type touches only its own file and `egress/index.ts`; adding or removing a proxy instance is a config-only change; legacy `PROXY`/`WORKER_URL` still work.
- No `any` (except justified, commented exceptions); no circular dependencies (enforce with `madge` or `eslint-plugin-import`).
- Final summary listing what changed, behavioural differences and known follow-ups.

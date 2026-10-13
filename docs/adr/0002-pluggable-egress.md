# ADR 0002 — Pluggable egress (proxy) layer with legacy shim

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

The legacy bot scrapes Amazon/Flipkart through a Cloudflare Worker (`WORKER_URL`) or a single proxy
(`PROXY`, via `HttpsProxyAgent`). There is no fallback, no pooling, and no configurability.

## Decision

Add an egress layer in front of all outbound HTTP (see `src/infra/egress`):

- **Providers** implement one typed interface: `direct`, `http-proxy`, `socks`
  (`socks-proxy-agent`), `cloudflare-worker` (typed contract shared with `worker/`), and
  `unlocker-api`. Adding a new provider type = one file + a registry entry.
- **Pools** group providers with a selection strategy (`round-robin`, `random`, `weighted`,
  `least-used`, `sticky-session`), per-provider cooldown with exponential backoff, and a
  request-attempt limit with fallback across providers.
- **Config** is `EGRESS_CONFIG`: inline JSON or a file path, with `${ENV_VAR}` interpolation so
  secrets stay out of the config file.
- **Legacy shim:** when `EGRESS_CONFIG` is unset, `PROXY` and/or `WORKER_URL` map to a single
  round-robin pool, keeping old deployments working unchanged (assumption A8).
- **Default:** when nothing is configured, requests go out `direct`.

## Consequences

- Failover and cooldowns are now explicit and testable with fakes/scripted providers.
- Block detection (captcha/robot responses) triggers provider cooldown and retry through the pool.
- Two config systems exist transiently (`PROXY`/`WORKER_URL` and `EGRESS_CONFIG`); the shim is
  documented as a compatibility bridge only.
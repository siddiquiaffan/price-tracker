# Cloudflare Worker (egress gateway)

This is the drop-in replacement for the legacy `worker.js`. It is an **optional**
egress provider: the app can scrape directly (or through an HTTP/SOCKS proxy)
and only needs this Worker when `PROXY`/direct access is blocked.

## Deploy

```bash
# one-time secret (recommended!)
wrangler secret put WORKER_SECRET --name price-tracker-egress

cd worker
wrangler deploy
```

Then configure the app:

```bash
EGRESS_CONFIG='{"defaultPool":"default","pools":{"default":{
  "strategy":"round-robin",
  "providers":[{"id":"worker","type":"cloudflare-worker","url":"https://yourapp.workers.dev","secret":"<WORKER_SECRET>"}]
}}}'
```

Or keep the legacy env vars: `WORKER_URL="https://yourapp.workers.dev"` (the app then
sends no secret; set `WORKER_SECRET` on the Worker and use `EGRESS_CONFIG` for a
hardened setup).

## Contract

The provider (`src/infra/egress/providers/cloudflare-worker.provider.ts`) sends:

- `?url=<target>` — the URL to fetch
- `x-egress-secret` — shared secret, matched against the `WORKER_SECRET` binding
- the original request method + headers + body

The Worker replies with the **upstream status code** (the legacy worker always
returned `200`, which broke block detection), the upstream headers, and:

- `x-final-url` — the URL after redirects, so the app can verify where the
  request actually landed
- `x-egress-error` / `x-egress-error-message` — set when the Worker itself
  failed (bad request, bad secret, disallowed host, upstream network failure)

Keep `worker/index.ts` in sync with `src/infra/egress/worker-contract.ts`.
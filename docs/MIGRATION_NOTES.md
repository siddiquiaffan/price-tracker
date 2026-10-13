# Migration Notes — `price-tracker` (JS → TypeScript rewrite)

> Step 0 of the rewrite. This documents the current system end-to-end **before** any new code is
> written: the real data flow, known bugs/races/duplication, and every implicit behaviour that must
> be preserved. Where the original is ambiguous, the assumption is recorded explicitly rather than
> silently chosen.

Original project: `siddiquiaffan/price-tracker` (GPL-3.0). Files read end-to-end:
`index.js`, `bot.js`, `config.js`, `db.js`, `utils.js`, `unshort.js`, `worker.js`, `Dockerfile`,
`Procfile`, `app.json`, `.github/workflows/docker-image.yml`, `package.json`, `README.md`.

---

## 1. What the system is

A Telegram bot plus an HTTP API that tracks Amazon and Flipkart product prices in a single MongoDB
database. It scrapes product pages through an HTTPS proxy and/or a Cloudflare Worker (to dodge IP
blocks) and notifies subscribers whenever a price changes.

Original file map:

| File | Role |
|------|------|
| `index.js` | Express HTTP server: product CRUD API, `/stats`, `/info`, `/setup`, `/bot` webhook. |
| `bot.js` | grammY bot: commands, URL auto-detect, hourly re-check loop, notifications. |
| `config.js` | Reads env vars, exits if `BOT_TOKEN`/`DB_URL` missing. |
| `db.js` | Mongo access (`manageUsers`, `manageProducts`) over collections `users`, `tasks`. |
| `utils.js` | URL regex, random id, per-store selectors, canonical URL builder, axios fetch + cheerio parse. |
| `unshort.js` | Expands short links by following redirects. |
| `worker.js` | Cloudflare Worker scraping proxy (open proxy, no auth). |

---

## 2. Actual data flow

### 2.1 Add / track a product
1. **Input**: a Telegram message containing a URL, an explicit `/track <link>`, or an API `POST /`.
2. **Short-link expansion**: `unshort.js` — if host's first label is in `merchants` (amazon,
   flipkart, snapdeal, ajio, myntra, jabong, bewakoof, limeroad, shein) it returns the URL as-is;
   otherwise it `axios.get`s the URL and uses the final `responseUrl` / redirect bookkeeping. No
   timeout, no redirect cap.
3. **Validation**: `utils.isUrl` regex.
4. **Merchant detection**: `productUrl.replace("www.","").split("//")[1].split(".")[0]`.
5. **Gate**: merchant must match `/amazon|flipkart|snapdeal/gi` (bot) or `/amazon|flipkart/gi` (API).
6. **Per-user cap**: count the user's trackings; must be `< LIMIT`.
7. **Canonical URL**: `utils.productCommonUrl` → Amazon `https://www.amazon.in/dp/<ASIN>`, Flipkart
   `https://www.flipkart.com/product/p/itme?pid=<pid>`.
8. **Scrape**: `utils.getProductDetails` → `axios` GET (Googlebot UA; `HttpsProxyAgent` only when
   `commonUrl` contains `amazon.`) → `cheerio` → per-store selectors → title/price/image.
9. **Persist**: `db.manageProducts('update')` upserts on `{ link }`, pushes a new
   `{ userId, tracking_id }` into `users[]` if the user isn't already present.
10. **Reply**: edit the "Tracking …" placeholder message with product details, or an error message.

### 2.2 Scheduled re-check and notify
1. `bot.js` runs `setInterval(track, 3_600_000)` — every hour, per running instance.
2. `track()` reads **all** `tasks` docs, iterates in batches of 10 with `Promise.all`.
3. For each product, re-scrape; if `details.ok && !isNaN(price) && price !== product.price`:
   - update the doc (notably `initPrice` is set to the **previous** `price` — see B11),
   - message every subscribed user with the change (format in §3.3),
   - `setTimeout` 1s; on error 5s.
4. No lock, no dedupe, no jitter: two instances both run the loop (B10).

### 2.3 HTTP API (`index.js`)
| Method | Path | Behaviour |
|--------|------|-----------|
| GET | `/` | `?userId=` → product docs for user; else `{error}` 500. **Not** API-key protected. |
| POST | `/` | `{url,userId,email}` → validate merchant, scrape, create tracking → `{ok,tracking_id}`. **Not** protected. |
| DELETE | `/` | `{tracking_id,userId}` → remove → `{ok:true}`. **Not** protected. |
| GET | `/stats` | Broken (B2). |
| GET | `/info` | `Bearer API_KEY` → `[{id,name,mail}]`. |
| GET | `/setup` | Sets Telegram webhook to `https://<host>/bot`. No secret token. |
| POST | `/bot` | grammY webhook handler. |

Dev polling starts when `NODE_ENV=development`.

---

## 3. Behavioural contract to preserve

### 3.1 Database schema
- Database: **`AS_TRACKER`** (hardcoded).
- Collection **`users`**: `{ id: number, name: string, mail?: string }`.
- Collection **`tasks`**: one document **per product link**, shared by all subscribers:
  ```
  {
    link: string,
    merchant: "amazon" | "flipkart",
    initPrice: string | number,
    price: string | number,        // stored as string today
    title: string,
    users: [ { userId: number, tracking_id: string } ]
  }
  ```
- `tracking_id`: 10-char base36 (today via `Math.random`).
- No indexes were ever defined.

### 3.2 Bot commands
`/start`, `/help`, `/track <link>`, `/list`, `/stop_<id>` (via `hears(/^\/stop_([a-z0-9])/)`, not a
real command), `/broadcast <msg>` (admin), `/users` (admin), `/stats`, `/update` (admin, triggers the
re-check immediately). Also: `::url` handler for any URL in a private chat, and the `stopTracking`
inline-keyboard callback.

### 3.3 Exact reply / notification strings (for snapshot tests)
- **/start**: `Hello {firstName}, I can track price for Amazon & Flipkart products (Soon more).\n\nCheck /help to get started.\n`
- **/help**: `/start - Start the bot\n/help - get this message.\n/track {Product Link} - Add product to tracking list.\n/stop_{Tracking ID} - Stop tracking.\n/list - Get list of products that are being tracked.\n\nFor more help join @@assupportchat.`
- **track pending**: `Tracking {merchant} product...`
- **track ok**: `<a href="{image}"> </a>\nTracking <b>{title}</b>\n\nCurrent Price: <b>{price}</b>\nLink: <a href="{link}">{merchant}</a>\n\nTo stop tracking send /stop_{tracking_id}`
- **track fail**: `Sorry, I couldn't track this product. Make sure you've sent correct product link.`
- **limit**: `I'm sorry, but you can't add more products as you've already reached the maximum limit.\n\nPlease delete atleast one product. And try again.\n\nTo get list send /list`
- **unsupported store**: `Sorry, I can't track this product. Cuz the link you sent is not a amazon or flipkart product link.`
- **invalid url**: `Sorry {firstName}, I can't track this product. Make sure you've sent correct product link.`
- **/list**: `Here is your tracking list:\n\n{items}`
  - item: `<b>{title}</b>\nLast Price: {price}\nLink: <a href="{link}">{merchant}</a>\nTo stop send /stop_{tracking_id}`
- **/list error**: `An error has beem occured please report it to admin. This my be due to you've added too many products.`
- **stop ok**: `Stopped tracking product with tracking id {id}`
- **stop fail**: `Sorry, I can't stop tracking product with tracking id {id}.`
- **/stats**: `Total Users: {n}\nTotal Products: {n}`
- **/users**: `List Of Users: \n\n` + lines `{id} - <a href="tg://user?id={id}">{name}</a>`
- **/update**: `Updating products...`
- **notification**:
  `<a href="{image}"> </a><b>Price has been {increased|decreased} by {abs(old-new)}</b>. \n\n<b>{title}</b>\n\nCurrent Price: <b>{price}</b>\nLink: <a href="{commonUrl}">{merchant}</a>\n\nTo stop tracking send /stop_{trackingId}`
  with inline keyboard: `[[Buy Now → commonUrl], [Stop Tracking - {tracking_id} → callback stopTracking]]`.
- **Common reply markup** (start/help/track): inline keyboard with Developer / Deals Channel /
  Updates / Support links.

### 3.4 Canonical URL rules
- Amazon: extract ASIN via a big regex; canonical `https://www.amazon.in/dp/<ASIN>`; notifications
  append the hardcoded affiliate tag `?tag=asloot-21`.
- Flipkart: `pid` search param; canonical `https://www.flipkart.com/product/p/itme?pid=<pid>`, or the
  path-only URL, else the original link.
- **Snapdeal**: selectors exist and the bot advertises it, but `productCommonUrl` returns `undefined`
  → `.includes` throws → it never works. See B13.

### 3.5 Notification policy
Today: notify on **every** change (both rise and fall). Keep this as the default.

---

## 4. Bugs, races, duplication and gaps found (regression test required before each fix)

| # | Location | Problem |
|---|----------|---------|
| B1 | `index.js:/info` | Sends success response, then falls through and sends `{error}` again → "headers already sent"; missing `return`. |
| B2 | `index.js:/stats` | `products.result.map(p => p += item.users.length)` references undefined `item`; empty `catch` → request hangs; `productCount` never computed. |
| B3 | `index.js` | Only `/info` checks `API_KEY`; `GET/POST/DELETE /` and `/stats` are unauthenticated. |
| B4 | `index.js:DELETE` | `if (tracking_id, userId)` uses the comma operator → effectively only checks `userId`. |
| B5 | `config.js`+`bot.js` | `ADMINS` is a raw string; `ADMINS.includes(number)` does substring matching → e.g. admin `12` matches `123`; empty default. |
| B6 | `config.js` | `LIMIT = Number(undefined)` → `NaN`; `noOfProducts < NaN` always false → when `LIMIT` is unset **nobody can track anything**. |
| B7 | `db.js:delete` | No existence/ownership check; always `{ok:true}` → `/stop` reports success even if nothing was deleted or the tracking belongs to someone else. |
| B8 | `db.js:delete` | Query `{ users: { userId, tracking_id } }` relies on exact sub-document match semantics for array elements — unreliable in Mongo. |
| B9 | `db.js` | No unique index on `link`; concurrent upserts can create duplicate product docs; no indexes at all. |
| B10 | `bot.js:track` | `setInterval` per instance with no lock/dedupe → duplicate checks + notifications when scaled; overlapping runs if a run exceeds the interval. |
| B11 | `bot.js:track` | `initPrice` is overwritten with the previous price each update — the original price is lost. |
| B12 | `utils.js` | Prices stored/compared as strings; `details.price > product.price` and `Math.abs(a-b)` rely on coercion. |
| B13 | `utils.js`/`bot.js` | Snapdeal advertised + selectors exist, but `productCommonUrl` returns `undefined` → `.includes` throws → never works. |
| B14 | `utils.js` | Selectors outdated/brittle (Amazon `#tp_price_block_total_price_ww`, Flipkart obfuscated `.B_NuCI`/`._30jeq3`) — likely already broken. |
| B15 | `bot.js:processUrl` | `"http" + url.split("http")[1]` is fragile and crashes when there is no `http`. |
| B16 | many | Empty `catch(e){}` blocks swallow failures; the "Tracking …" message is never edited on error. |
| B17 | `worker.js` | Open proxy: no shared secret, no host allowlist → SSRF and abuse. |
| B18 | `unshort.js` | No timeout, no redirect cap, incomplete SSRF guard; axios follows redirects anywhere. |
| B19 | `utils.js` | `getRandomId` uses `Math.random` → collision-prone tracking IDs. |
| B20 | `bot.js:track` | 1s/5s `setTimeout` pacing inside `Promise.all` — no real rate limiting or jitter. |
| B21 | `bot.js` | `/broadcast` `.replace(undefined,...)`, unguarded `JSON.parse`, no rate-limit/blocked-user handling. |
| B22 | infra | No health endpoints, no graceful shutdown, `console.log` everywhere, no structured logs / correlation IDs. |
| B23 | `Dockerfile` | `node:16` (EOL), root user, `npm install`, copies everything. |
| B24 | `db.js` | `manageUsers` returns `undefined` on error while callers assume `{ok,result}`. |
| B25 | `bot.js` | `/stats` uses `Promise.all([manageUsers, manageProducts].map(fn => fn({}, 'read')))` which happens to work but is accidental. |

---

## 5. Assumptions (recorded instead of silently deciding)

- **A1 — API auth scope.** `API_KEY` is intended to protect the whole API, but today only `/info`
  checks it. The rewrite guards **all** API routes and documents this as a behavior change.
- **A2 — Notification default.** Notify on **every** change (matches today). Additional strategies
  (`only-on-drop`, `threshold`) are opt-in extension points.
- **A3 — Snapdeal.** Not a working target today. It is **not** shipped in the first release; it
  becomes the canonical "add a third store" example.
- **A4 — Affiliate tag.** The hardcoded `asloot-21` remains the default but becomes configurable.
- **A5 — `LIMIT` default.** When unset, default to **5** (fixes B6) rather than `NaN`.
- **A6 — Database compatibility.** Keep DB name `AS_TRACKER` and collection names `tasks`/`users`
  so existing deployments migrate with zero downtime.
- **A7 — Webhook host.** `/setup` derives the host from the request; keep this, but add a
  Telegram webhook **secret token** verified on incoming updates.
- **A8 — Legacy egress.** A deployment with only `PROXY` and/or `WORKER_URL` set must keep working;
  these map into the new egress config (back-compat shim).
- **A9 — Liveness probe.** `GET /healthz` returns `{ ok: true }` **without** an API key, so Docker /
  platform health checks and the CI smoke test can probe the process. This is a new endpoint
  (not in legacy); the business routes stay fully guarded per A1.
- **A10 — Egress configuration changes.** `EGRESS_CONFIG` (inline JSON or file path, with `${ENV_VAR}`
  interpolation) is the new way to define pools/providers. This is optional; the legacy `PROXY` /
  `WORKER_URL` shim and the built-in `direct` default keep old deployments working unchanged.

---

## 6. Legacy → new mapping

| Legacy | New |
|--------|-----|
| `config.js` env reads | `src/config` (Zod, fail-fast, typed) |
| `db.manageUsers/manageProducts` | `src/infra/db/repositories/*` behind `core/ports` |
| `utils.getProductDetails` + `selectors` | `src/stores/amazon` + `src/stores/flipkart` (pure `parse`) |
| `utils.makeRequest` + `HttpsProxyAgent` | `src/infra/http/fetcher` → `src/infra/egress` providers/pool |
| `unshort.js` | `core/services/UrlResolver` (redirect cap + SSRF guard) |
| `index.js` Express | `src/interfaces/api` on Hono |
| `bot.js` grammY | `src/interfaces/telegram` (grammY, webhook + polling) |
| `setInterval(track)` | `src/infra/queue` + scheduler (BullMQ / in-memory) |
| `worker.js` | `worker/` (TypeScript + wrangler, shared contract, secret + allowlist) |
| price as string | `Money` (integer minor units + ISO currency) via migration |

---

## 7. Test-fixture sourcing

Real HTML fixtures live under `tests/fixtures/<store>/` with variants: in-stock, deal price,
out-of-stock, no-price, JSON-LD, captcha. Each fixture's origin URL and capture date is recorded in
`tests/fixtures/README.md`. Where live access is blocked, the selector is marked
**"needs verification"** rather than guessed.

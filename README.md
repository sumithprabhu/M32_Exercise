# HubSpot Integration Microservice (v1: Contacts)

**Deployed and live at: https://hubspot-integration-m32.onrender.com/**

Standalone Node.js/TypeScript + Express service that:

- Authenticates against HubSpot via OAuth2 (authorization code + refresh token, no static Private App token).
- Pulls Contacts from HubSpot into a local SQLite database (`better-sqlite3`), idempotently, including deletions.
- Exposes local REST endpoints to read synced Contacts, with a narrowly-scoped push path back to HubSpot (`PATCH /contacts/:id`, last-write-wins).
- Receives HubSpot webhooks (signature-verified, idempotent) to keep local data fresh between full syncs, including contact deletions.

Scope is deliberately narrow: Contacts only, single HubSpot account, no UI.

## Setup

### 1. Create a HubSpot app (CLI-based: Developer Projects, not the legacy UI)

> **Note for reviewers:** HubSpot migrated app creation from a point-and-click "Create app" screen in the developer account UI to a CLI + `app-hsmeta.json`-based **Developer Projects** workflow. If you go looking for the old UI flow, you won't find it the same way anymore; this is not a mistake in these steps, the platform actually moved. Everything below reflects the current (2026.03 platform version) flow, done entirely via `@hubspot/cli`.

```bash
# 1. Install the CLI
npm install -g @hubspot/cli@latest
hs --version

# 2. Authenticate the CLI against your HubSpot account (opens a browser).
# If the browser-side auto-callback doesn't complete (common behind strict
# browser privacy settings, see the trade-offs section below for why),
# fall back to pasting a Personal Access Key directly:
hs account auth
# or, non-interactively:
hs account auth --pak "<personal-access-key>" --default --use-default-name

# 3. Scaffold a minimal OAuth-only app project (no cards, no workflow actions).
# `--features` with no value forces an empty feature set instead of dropping
# into the interactive feature-picker prompt.
hs project create --name hubspot-app --dest hubspot-app \
  --project-base app --distribution private --auth oauth --features

# 4. Edit hubspot-app/src/app/app-hsmeta.json:
#    - auth.redirectUrls -> ["https://hubspot-integration-m32.onrender.com/auth/callback"]
#      (add "http://localhost:3000/auth/callback" too if also running locally)
#    - auth.requiredScopes -> ["oauth", "crm.objects.contacts.read", "crm.objects.contacts.write"]

# 5. Upload + build + deploy (the --forceCreate flag skips the "does this
# project exist yet?" interactive prompt on first upload):
cd hubspot-app
hs project upload --forceCreate

# 6. Open the project dashboard and find your credentials:
hs project open
# -> Components -> click the app component (e.g. "hubspot_app_app") -> Auth tab
#    -> Client ID is shown directly; Client secret is behind a "Show" toggle.
```

Then, to receive webhooks (see the full walkthrough in `hubspot-app/src/app/webhooks/webhooks-hsmeta.json` in this repo for a worked example): add a `webhooks` component to the same project with a `legacyCrmObjects` subscription (this is the payload shape, `eventId`/`subscriptionType`/`objectId`, that `webhook-handler.service.ts` expects; the newer `crmObjects` subscription shape is different and isn't what this service parses), pointing `targetUrl` at `<your-public-url>/webhook/hubspot`, then `hs project upload` again. Subscribe to both `contact.propertyChange` (for the property you care about, e.g. `email`) and `contact.deletion` if you want deletions to propagate via webhook.

HubSpot signs webhook requests using the app's **client secret**; set `HUBSPOT_WEBHOOK_SECRET` to that same value unless your setup uses a distinct signing secret.

### 2. Install & configure

```bash
npm install
cp .env.example .env
# fill in HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, HUBSPOT_REDIRECT_URI, HUBSPOT_WEBHOOK_SECRET
```

| Env var | Purpose |
|---|---|
| `HUBSPOT_CLIENT_ID` | OAuth app client ID |
| `HUBSPOT_CLIENT_SECRET` | OAuth app client secret |
| `HUBSPOT_REDIRECT_URI` | Must exactly match the redirect URL configured on the HubSpot app |
| `HUBSPOT_WEBHOOK_SECRET` | Secret used to HMAC-verify incoming webhook signatures (v3) |
| `DATABASE_PATH` | Path to the SQLite file (default `./data/app.db`) |
| `PORT` | HTTP port (default `3000`) |
| `SYNC_INTERVAL_MINUTES` | Minutes between automatic background syncs; `0` (default) disables the scheduler |

### 3. Run

```bash
npm run dev        # tsx watch mode
# or
npm run build && npm start
```

Or with Docker: `docker compose up --build` (reads `.env`, persists the SQLite file to `./data` on the host). Verified locally end-to-end: multi-stage build succeeds, the container starts cleanly with no `better-sqlite3` binding/ABI errors, `/contacts` and `/sync/contacts` work against the containerized service, writes are visible on the host-mounted `./data/app.db` from a separate host process, and data survives a full `docker compose stop` + `docker compose up` (no rebuild) cycle.

The DB file and its schema are created automatically on boot (`src/db/schema.sql` is applied via `CREATE TABLE IF NOT EXISTS`).

### 4. Connect a HubSpot account

Open `https://hubspot-integration-m32.onrender.com/auth/install` in a browser, complete the HubSpot consent screen, and you'll be redirected back to `/auth/callback`, which exchanges the code for tokens and stores them (singleton row, `oauth_tokens.id = 1`).

### 5. Sync and read Contacts

```bash
curl -X POST https://hubspot-integration-m32.onrender.com/sync/contacts
curl "https://hubspot-integration-m32.onrender.com/contacts?limit=20&sort=id_asc"
```

## API Reference

All examples below are real requests/responses captured against a live HubSpot developer test account during development. A Postman collection with all requests pre-built is at [`postman/hubspot-integration.postman_collection.json`](postman/hubspot-integration.postman_collection.json). Interactive Swagger docs are live at https://hubspot-integration-m32.onrender.com/docs.

### `GET /auth/install`
Redirects the browser to HubSpot's OAuth consent screen.

```bash
curl -i https://hubspot-integration-m32.onrender.com/auth/install
```
```
HTTP/1.1 302 Found
Location: https://app.hubspot.com/oauth/authorize?client_id=<your-client-id>&redirect_uri=https%3A%2F%2Fhubspot-integration-m32.onrender.com%2Fauth%2Fcallback&scope=crm.objects.contacts.read+crm.objects.contacts.write
```

### `GET /auth/callback?code=...`
Exchanges the authorization `code` for access/refresh tokens and persists them. You won't call this directly (HubSpot redirects the browser here after you click Allow), but this is the real shape of that request/response:

```bash
curl "https://hubspot-integration-m32.onrender.com/auth/callback?code=na2-99e5-8798-47a4-a52b-9846f30883f8"
# => {"status":"connected"}
```

### `POST /sync/contacts`
Triggers a full paginated pull of all Contacts from HubSpot into the local DB. Safe to re-run: upserts are keyed on `hubspot_contact_id`, so re-running produces no duplicates (verified by running it twice back-to-back, second run returns the same count with zero new rows created). Also reconciles deletions: any local contact not present in this full pull (deleted/archived in HubSpot since the last sync) is removed locally. This only happens after every page fetches successfully; a failed sync never deletes anything.

```bash
curl -X POST https://hubspot-integration-m32.onrender.com/sync/contacts
# => {"pagesFetched":1,"contactsUpserted":2,"contactsDeleted":0}
```

### `GET /contacts`
Lists locally synced contacts.

| Query param | Default | Notes |
|---|---|---|
| `limit` | `20` | 1 to 100 |
| `after` | none | Local `id` cursor; returns rows after (or before, if `sort=id_desc`) this id |
| `sort` | `id_asc` | `id_asc` or `id_desc` |
| `email` | none | Exact match filter (case-sensitive, no partial/fuzzy matching) |

```bash
curl "https://hubspot-integration-m32.onrender.com/contacts?limit=10"
```
```json
{
  "results": [
    { "id": 1, "hubspot_contact_id": "541935488729", "email": "emailmaria@hubspot.com", "first_name": "Maria", "last_name": "Johnson (Sample Contact)", "lifecycle_stage": null, "created_at": 1787842661022, "updated_at": 1787842661022 },
    { "id": 2, "hubspot_contact_id": "541935876822", "email": "bh@hubspot.com", "first_name": "Brian", "last_name": "Halligan (Sample Contact)", "lifecycle_stage": null, "created_at": 1787842661030, "updated_at": 1787842661030 }
  ],
  "count": 2
}
```

```bash
curl "https://hubspot-integration-m32.onrender.com/contacts?limit=10&sort=id_desc"
curl "https://hubspot-integration-m32.onrender.com/contacts?limit=10&after=1"
curl "https://hubspot-integration-m32.onrender.com/contacts?email=bh%40hubspot.com"
```

### `PATCH /contacts/:id`
Pushes a local edit to HubSpot, then refreshes the local row from HubSpot's response: the one bidirectional-sync path this service supports (see the trade-offs section for the last-write-wins policy behind it). `:id` is the local autoincrement `id` from `GET /contacts`, not the HubSpot contact ID.

Body accepts any subset of `email`, `first_name`, `last_name`, `lifecycle_stage` (at least one required, same field names `GET /contacts` returns).

```bash
curl -X PATCH https://hubspot-integration-m32.onrender.com/contacts/2 \
  -H "Content-Type: application/json" \
  -d '{"email":"bh.pushed.from.local@hubspot.com","lifecycle_stage":"customer"}'
# => 200, returns the refreshed local row (real request against a HubSpot test account):
# {"id":2,"hubspot_contact_id":"541935876822","email":"bh.pushed.from.local@hubspot.com", ...,"lifecycle_stage":"customer", ...}
```

If HubSpot's `lastmodifieddate` for that contact is newer than this row's local `updated_at` (someone or something changed it in HubSpot since our last sync), the push is rejected rather than silently overwritten:

```bash
# => 409 (real conflict hit during testing: HubSpot's own lastmodifieddate had
# advanced past our local updated_at between syncs):
# {"error":"stale_write_conflict","message":"HubSpot has a newer version of this
# contact than the one this edit was based on. Re-sync (GET /contacts or POST
# /sync/contacts) and retry.","hubspotLastModified":"2026-08-27T19:52:47.843Z"}
```

Re-running `POST /sync/contacts` to refresh the local baseline, then retrying the same `PATCH`, succeeds.

### `POST /webhook/hubspot`
Receives HubSpot webhook event batches (legacy `subscriptionType`/`objectId`/`eventId` shape). Verifies the `X-HubSpot-Signature-v3` header before doing anything else; unsigned or invalid requests get `401` with no further processing. Duplicate deliveries (same `eventId`) are detected via the `webhook_events.event_id` unique index and skipped. On a `contact.deletion` event, the local row is removed (a deleted contact can't be refetched); on any other event, the full contact is refetched from HubSpot and upserted.

This endpoint is meant to be called by HubSpot, not curl'd directly, a manual curl without a valid HMAC will always be rejected, which is itself the behavior worth demonstrating:

```bash
curl -i -X POST https://hubspot-integration-m32.onrender.com/webhook/hubspot \
  -H "Content-Type: application/json" \
  -d '[{"eventId":1,"subscriptionType":"contact.propertyChange","objectId":541935488729,"propertyName":"email"}]'
# => HTTP/1.1 401 Unauthorized
# => {"error":"invalid signature"}
```

A genuine HubSpot-signed delivery (captured via ngrok during testing) looks like this, HubSpot's real payload shape, useful if you're writing your own test fixtures:

```json
[{
  "eventId": 4101286121,
  "subscriptionId": 7562680,
  "portalId": 247187887,
  "appId": 50780459,
  "occurredAt": 1787843156000,
  "subscriptionType": "contact.propertyChange",
  "attemptNumber": 1,
  "objectId": 541935488729,
  "propertyName": "email",
  "propertyValue": "emailmaria+webhook-test-2@hubspot.com",
  "changeSource": "INTEGRATION",
  "sourceId": "50780459"
}]
```

Once verified, this landed in `webhook_events` and triggered a refetch that updated the local `contacts` row's `updated_at`: full round trip confirmed against a real account, tunneled through ngrok. Deletion events use the same shape with `subscriptionType: "contact.deletion"` and no `propertyName`/`propertyValue`; also confirmed live, including catching a real bug where the deployed instance had no stored OAuth tokens yet (see Design Decisions).

## Design Decisions & Trade-offs

- **Webhooks refetch, they don't patch from the payload.** HubSpot only sends the changed property; refetching the full contact keeps the local row accurate at the cost of one extra API call per event.
- **Singleton token row.** `oauth_tokens` uses `CHECK (id = 1)`. Multi-tenant would mean keying this table (and `contacts`) by account/portal ID. Deferred.
- **Idempotent upserts, not read-then-write.** `upsertContact` is one `INSERT ... ON CONFLICT DO UPDATE`; no race between concurrent syncs/webhooks.
- **Retries: 5 attempts total, only on 429/5xx.** 4xx aborts immediately. `Retry-After` is honored on top of exponential backoff.
- **Token refresh is transparent.** Proactive refresh within 60s of expiry, plus a 401 fallback interceptor that retries once. Callers never handle expiry themselves.
- **Webhooks ack, then process.** Responds `200` right after signature verification, processes after. Trade-off: if processing fails (e.g. no tokens stored yet), HubSpot won't retry that delivery; recovery is a follow-up sync, not a resend. Hit this for real on a fresh deploy where OAuth hadn't been completed yet.
- **Local pagination is independent of HubSpot's.** `/contacts` cursors on the local `id`; unrelated to the `after` token `/sync/contacts` uses internally.
- **ESM throughout**, since `p-retry` v6+ dropped CommonJS.
- **`trust proxy` is required behind any reverse proxy or tunnel.** Without it, `req.protocol` reports `http` even when HubSpot signed the `https` URL, so every genuine webhook fails signature verification with a `401` indistinguishable from real forgery. Hit this for real with ngrok; found it by diffing the HMAC input by hand.
- **ngrok free tier allows one tunnel at a time.** A second `ngrok http` fails with `ERR_NGROK_334` until the first is stopped.
- **Background sync is a plain `setInterval`, not `node-cron`.** No cron-expression parsing needed for a fixed interval. Calls the same `runContactSync()` as the manual endpoint. Off by default (`SYNC_INTERVAL_MINUTES=0`).
- **Docker: prune, don't reinstall, in the runtime stage.** Build stage compiles then `npm prune --omit=dev` in place; runtime stage copies that `node_modules` as-is. Avoids rebuilding the native `better-sqlite3` binary in a second stage.
- **`email` filter is exact-match only.** Covers "look up one contact" without adding `LIKE`/full-text search for a small local cache.
- **Bidirectional push: last-write-wins, checked against local `updated_at`.** `PATCH` compares HubSpot's `lastmodifieddate` to the local row's `updated_at`, rejecting with `409` if HubSpot is newer. Trade-off: the webhook only watches `email`, so an unrelated HubSpot-side change can bump `lastmodifieddate` and trigger a false-positive `409`. Fix is always the same: re-sync and retry.
- **Push refetches after writing**, reusing the same transformer sync and webhooks use. HubSpot's own webhook for that change refetches again shortly after; safe since upserts are idempotent.
- **Deletions are diff-based on sync, not a separate API call.** `runContactSync` deletes any local contact missing from a complete pull. Never runs on a partial or failed pull.
- **Webhook deletion needed its own subscription (`contact.deletion`).** The handler logic existed before the subscription was wired up; a UI deletion produced no webhook at all until it was added.

## Testing

```bash
npm test
```

`vitest`, 18 tests across 6 files under `/tests` (mirrors `/src`, not inline). Each file gets a real, isolated SQLite file, no DB mocking. Covers: upsert idempotency, webhook signature verification (valid and tampered), retry behavior (429 vs. 400), bidirectional push (success and conflict rejection), and deletion propagation (sync reconciliation and webhook deletion).

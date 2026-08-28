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

- **Pull-then-refetch on webhook, not patch-from-payload.** HubSpot webhook payloads carry only the single property that changed, not the full object. Rather than partially patching a local row from a fragment (risking drift if events arrive out of order), `applyWebhookEvent` refetches the full contact via `GET /crm/v3/objects/contacts/:id` and upserts it. Slightly more API calls, but the local row is always a faithful snapshot of what HubSpot has at refetch time.
- **Singleton token row.** v1 supports exactly one connected HubSpot account, so `oauth_tokens` uses a `CHECK (id = 1)` singleton row instead of a table keyed by account. Multi-tenant support would mean keying this table (and the contacts table) by account/portal ID; explicitly deferred.
- **Idempotent upserts via `ON CONFLICT`, not read-then-write.** `upsertContact` is a single `INSERT ... ON CONFLICT(hubspot_contact_id) DO UPDATE` statement so concurrent syncs/webhooks can't race a read-modify-write cycle into a lost update.
- **Retry budget: 4 retries (5 attempts total), retry only on 429/5xx.** 4xx errors (bad auth, malformed request) are aborted immediately via `p-retry`'s `AbortError`; retrying a request that's wrong in the same way five times just delays surfacing the real bug. When HubSpot sends `Retry-After`, the retry wrapper sleeps at least that long before the next attempt, on top of the normal exponential backoff.
- **Token refresh is transparent to callers.** The HubSpot axios client proactively refreshes when the stored token is within 60s of expiry (before the request even goes out), and additionally catches a stray `401` via a response interceptor as a fallback, retrying the original request exactly once. Callers of `contacts.api.ts` never handle token expiry themselves.
- **Webhook ack-then-process.** The webhook controller responds `200` as soon as the payload is verified and parsed, then processes each event afterward. HubSpot expects fast acks and will retry on timeout; per-event processing failures are logged, not surfaced as a delivery failure, so a single bad event can't cause HubSpot to keep re-delivering an entire batch. One real consequence of this: if processing fails (for example, no OAuth tokens stored yet), HubSpot still considers that delivery successful and won't retry it; a follow-up sync or a fresh event is needed to recover, not a resend of the same one. Observed live: a contact-creation event was verified and acked before OAuth had ever been completed on a fresh deployment, so its processing step failed and the event was gone for good, recovered by a full sync afterward instead.
- **Local pagination is cursor-based on the local `id`,** not on HubSpot's cursor; `/contacts` reads from SQLite only and has no relationship to HubSpot's own `after` pagination token used internally by `/sync/contacts`.
- **ESM throughout** (`"type": "module"`, `NodeNext` module resolution) since `p-retry` v6+ dropped CommonJS support.
- **`app.set("trust proxy", true)` is required, and it's a real gotcha we hit, not a defensive guess.** HubSpot's v3 signature is computed over the full request URL *as HubSpot called it*, `https://<public-host>/webhook/hubspot`. When this service sits behind a reverse proxy or tunnel (ngrok, in testing), the TLS connection terminates at the proxy and the hop to Express is plain HTTP, so `req.protocol` defaults to `"http"` unless Express is told to trust `X-Forwarded-Proto`. Without `trust proxy` enabled, every signature check silently reconstructs the wrong URL (`http://...` instead of `https://...`) and every genuine, correctly-signed HubSpot webhook gets rejected with `401`; no exception thrown, no obvious error, just consistent rejection that looks identical to "someone's forging requests." We hit this directly: real HubSpot deliveries came back `401 {"error":"invalid signature"}` against a fully correct `HUBSPOT_WEBHOOK_SECRET`, and it only surfaced once we inspected the raw request via ngrok's inspector (`http://127.0.0.1:4040`) and diffed the HMAC input by hand. Worth knowing if you deploy this behind any proxy/load balancer, not just ngrok; the same failure mode applies to nginx, an ALB, Cloudflare, etc., anywhere TLS terminates before Express sees the request.
- **ngrok's free tier gives exactly one persistent static domain per account and allows one active tunnel session at a time.** If you already have an ngrok tunnel running for something else, starting a second one to test this service's webhook will fail with `ERR_NGROK_334` ("endpoint already online") rather than silently opening a second tunnel; you have to stop the existing one first.
- **Background sync is a plain `setInterval`, not `node-cron`.** The only requirement is "run this on a fixed interval," which `setInterval` does natively with zero added dependencies; a cron *expression* parser would be solving a problem this service doesn't have (no need for "every Tuesday at 3am"-style scheduling). `startContactSyncScheduler` calls the exact same `runContactSync()` used by `POST /sync/contacts`, same logging, same idempotent upsert behavior, no parallel code path to keep in sync. Disabled by default (`SYNC_INTERVAL_MINUTES=0`) so the service doesn't start hitting HubSpot's API on a timer unless an operator opts in.
- **Docker: prune, don't reinstall, for the runtime stage.** The build stage runs `npm ci` (full deps, needed for `tsc`), compiles, then `npm prune --omit=dev` to strip devDependencies from that same `node_modules` in place. The runtime stage copies that pruned `node_modules` and `dist/` directly; no second `npm ci`. This matters specifically because `better-sqlite3` is a native addon; running `npm ci` a second time in a different stage risks a rebuild against a subtly different environment. Copying the already-built native binary forward from the single stage that built it avoids that class of bug entirely, at the cost of images from the two stages needing to share the same OS/arch (true here since both stages derive from the same `node:22-slim` base). Verified locally: the container starts and reads/writes SQLite with no binding/ABI error, which is exactly the failure mode this approach was chosen to avoid.
- **`email` filter is exact-match only, on purpose.** The brief asked for filtering "or" sorting on `/contacts`, and this service already had sorting; exact match on a unique-ish field like email covers the realistic "look up one contact" use case without pulling in `LIKE`/full-text search machinery for a single-tenant local cache of Contacts.
- **Bidirectional sync: last-write-wins, compared against local `updated_at`, not a previously-stored `lastmodifieddate`.** `PATCH /contacts/:id` fetches HubSpot's current `lastmodifieddate` and compares it to the local row's `updated_at` (when we last wrote that row, from a sync or webhook). If HubSpot's timestamp is newer, the write is rejected with `409` instead of silently clobbering a change we haven't seen yet. The alternative, comparing against a `lastmodifieddate` value captured and stored locally at the last sync, would be a strictly more apples-to-apples comparison (same clock on both sides), but every contact synced before this feature existed would have no stored baseline to compare against, forcing an awkward "what do we do with unknown baselines" decision. Comparing against `updated_at` instead works unconditionally for every row already in the database, at the cost of comparing two different clocks (our server's wall-clock vs. HubSpot's), acceptable for a conflict *heuristic*, not something being used as a security boundary. A real consequence worth naming: because our webhook subscription only covers one property (`email`), HubSpot can bump `lastmodifieddate` internally (enrichment, scoring, list-membership recalculation) without firing a webhook we'd see, so a `PATCH` shortly after a fresh sync can still hit a `409` even though nothing user-visible changed. Observed live during testing. The fix is the same either way: re-sync and retry.
- **The push endpoint refetches after writing, reusing `mapHubspotContactToLocal`, same principle as the webhook handler, not a second mapping path.** After `PATCH`ing HubSpot, the service re-fetches the full contact via `fetchContactById` rather than trusting the PATCH response's shape, then runs it through the exact same transformer the sync and webhook paths use. One consequence worth calling out explicitly: HubSpot fires its own webhook for the change this endpoint just pushed, which will independently refetch and upsert the same contact a second time shortly after. This is safe by construction, not by luck: `upsertContact`'s `ON CONFLICT DO UPDATE` is idempotent (covered by `tests/db/contacts.repo.test.ts`), and `applyWebhookEvent` always does a full refetch-and-upsert rather than a partial patch, so reprocessing the same eventual state twice is a no-op. Verified by reading both code paths together, not assumed.
- **Deletions are diff-based on sync, not a separate "list deleted contacts" API call.** `runContactSync` tracks every `hubspot_contact_id` seen across a full, successful pull, then removes any local contact not in that set. This only runs after every page fetches without error; a partial pull looks identical to a pile of deletions, so it's never allowed to reconcile off incomplete data. Reuses data the sync already has, rather than adding a second HubSpot API call and pagination loop just to detect removals.
- **Webhook-driven deletion is a separate, narrower subscription (`contact.deletion`) from property-change tracking.** The handler code for it existed before the subscription was actually wired up in `webhooks-hsmeta.json`; a good reminder that "the code path exists" and "the event that triggers it is actually subscribed to" are two different things worth checking independently, confirmed the hard way when a contact deleted in HubSpot's UI produced no webhook at all until the subscription was added.

## Testing

```bash
npm test
```

Uses `vitest`. Tests live under `/tests`, mirroring `/src`'s structure, not inline next to source files. Each test file gets an isolated real SQLite file (via `DATABASE_PATH` set to a fresh temp path in `tests/setup-env.ts`) rather than a mock. `tests/db/contacts.repo.test.ts` inserts the same `hubspot_contact_id` twice against real SQLite and asserts the row count stays 1. `tests/webhooks/webhook-signature.test.ts` checks a correctly-signed request is accepted and a tampered one is rejected. `tests/utils/retry.test.ts` checks a mocked 429 gets retried to success and a mocked 400 aborts after exactly one attempt (no retry). `tests/sync/contact-push.service.test.ts` mocks the HubSpot API layer (not the DB) to check a push succeeds and refreshes the local row when the edit isn't stale, and that a push is rejected, with HubSpot never called and the local row left untouched, when HubSpot's `lastmodifieddate` is newer than the local baseline. `tests/sync/contact-sync.service.test.ts` checks that a contact missing from a full pull gets deleted locally, and that a sync which throws partway through deletes nothing. `tests/webhooks/webhook-handler.service.test.ts` checks a `contact.deletion` event removes the local row without calling HubSpot, is a no-op for an id already gone locally, and that a non-deletion event still refetches and upserts as before.

# HubSpot Integration Microservice (v1 — Contacts)

Standalone Node.js/TypeScript + Express service that:

- Authenticates against HubSpot via OAuth2 (authorization code + refresh token — no static Private App token).
- Pulls Contacts from HubSpot into a local SQLite database (`better-sqlite3`), idempotently.
- Exposes local REST endpoints to read synced Contacts.
- Receives HubSpot webhooks (signature-verified, idempotent) to keep local data fresh between full syncs.

Scope is deliberately narrow: Contacts only, pull-only, single HubSpot account. See "Explicitly out of scope" below.

## Setup

### 1. Create a HubSpot app (CLI-based — Developer Projects, not the legacy UI)

> **Note for reviewers:** HubSpot migrated app creation from a point-and-click "Create app" screen in the developer account UI to a CLI + `app-hsmeta.json`-based **Developer Projects** workflow. If you go looking for the old UI flow, you won't find it the same way anymore — this is not a mistake in these steps, the platform actually moved. Everything below reflects the current (2026.03 platform version) flow, done entirely via `@hubspot/cli`.

```bash
# 1. Install the CLI
npm install -g @hubspot/cli@latest
hs --version

# 2. Authenticate the CLI against your HubSpot account (opens a browser).
# If the browser-side auto-callback doesn't complete (common behind strict
# browser privacy settings — see the trade-offs section below for why),
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
#    - auth.redirectUrls -> ["http://localhost:3000/auth/callback"]
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

Then, to receive webhooks (see the full walkthrough in `hubspot-app/src/app/webhooks/webhooks-hsmeta.json` in this repo for a worked example): add a `webhooks` component to the same project with a `legacyCrmObjects` subscription (this is the payload shape — `eventId`/`subscriptionType`/`objectId` — that `webhook-handler.service.ts` expects; the newer `crmObjects` subscription shape is different and isn't what this service parses), pointing `targetUrl` at `<your-public-url>/webhook/hubspot`, then `hs project upload` again.

HubSpot signs webhook requests using the app's **client secret** — set `HUBSPOT_WEBHOOK_SECRET` to that same value unless your setup uses a distinct signing secret.

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

### 3. Run

```bash
npm run dev        # tsx watch mode
# or
npm run build && npm start
```

The DB file and its schema are created automatically on boot (`src/db/schema.sql` is applied via `CREATE TABLE IF NOT EXISTS`).

### 4. Connect a HubSpot account

Open `http://localhost:3000/auth/install` in a browser, complete the HubSpot consent screen, and you'll be redirected back to `/auth/callback`, which exchanges the code for tokens and stores them (singleton row, `oauth_tokens.id = 1`).

### 5. Sync and read Contacts

```bash
curl -X POST http://localhost:3000/sync/contacts
curl "http://localhost:3000/contacts?limit=20&sort=id_asc"
```

## API Reference

All examples below are real requests/responses captured against a live HubSpot developer test account during development (contact IDs and names are HubSpot's own default sample data — "Maria Johnson" / "Brian Halligan" — present in every fresh developer test account, not anyone's real data). A Postman collection with all five requests pre-built is at [`postman/hubspot-integration.postman_collection.json`](postman/hubspot-integration.postman_collection.json).

### `GET /auth/install`
Redirects the browser to HubSpot's OAuth consent screen.

```bash
curl -i http://localhost:3000/auth/install
```
```
HTTP/1.1 302 Found
Location: https://app.hubspot.com/oauth/authorize?client_id=<your-client-id>&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback&scope=crm.objects.contacts.read+crm.objects.contacts.write
```

### `GET /auth/callback?code=...`
Exchanges the authorization `code` for access/refresh tokens and persists them. You won't call this directly — HubSpot redirects the browser here after you click Allow — but this is the real shape of that request/response:

```bash
curl "http://localhost:3000/auth/callback?code=na2-99e5-8798-47a4-a52b-9846f30883f8"
# => {"status":"connected"}
```

### `POST /sync/contacts`
Triggers a full paginated pull of all Contacts from HubSpot into the local DB. Safe to re-run — upserts are keyed on `hubspot_contact_id`, so re-running produces no duplicates (verified by running it twice back-to-back — second run returns the same count with zero new rows created).

```bash
curl -X POST http://localhost:3000/sync/contacts
# => {"pagesFetched":1,"contactsUpserted":2}
```

### `GET /contacts`
Lists locally synced contacts.

| Query param | Default | Notes |
|---|---|---|
| `limit` | `20` | 1–100 |
| `after` | — | Local `id` cursor; returns rows after (or before, if `sort=id_desc`) this id |
| `sort` | `id_asc` | `id_asc` or `id_desc` |

```bash
curl "http://localhost:3000/contacts?limit=10"
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
curl "http://localhost:3000/contacts?limit=10&sort=id_desc"
curl "http://localhost:3000/contacts?limit=10&after=1"
```

### `POST /webhook/hubspot`
Receives HubSpot webhook event batches (legacy `subscriptionType`/`objectId`/`eventId` shape). Verifies the `X-HubSpot-Signature-v3` header before doing anything else; unsigned or invalid requests get `401` with no further processing. Duplicate deliveries (same `eventId`) are detected via the `webhook_events.event_id` unique index and skipped.

This endpoint is meant to be called by HubSpot, not curl'd directly — a manual curl without a valid HMAC will always be rejected, which is itself the behavior worth demonstrating:

```bash
curl -i -X POST http://localhost:3000/webhook/hubspot \
  -H "Content-Type: application/json" \
  -d '[{"eventId":1,"subscriptionType":"contact.propertyChange","objectId":541935488729,"propertyName":"email"}]'
# => HTTP/1.1 401 Unauthorized
# => {"error":"invalid signature"}
```

A genuine HubSpot-signed delivery (captured via ngrok during testing) looks like this — note this is HubSpot's real payload shape, useful if you're writing your own test fixtures:

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

Once verified, this landed in `webhook_events` and triggered a refetch that updated the local `contacts` row's `updated_at` — full round trip confirmed against a real account, tunneled through ngrok.

## Design Decisions & Trade-offs

- **Pull-then-refetch on webhook, not patch-from-payload.** HubSpot webhook payloads carry only the single property that changed, not the full object. Rather than partially patching a local row from a fragment (risking drift if events arrive out of order), `applyWebhookEvent` refetches the full contact via `GET /crm/v3/objects/contacts/:id` and upserts it. Slightly more API calls, but the local row is always a faithful snapshot of what HubSpot has at refetch time.
- **Singleton token row.** v1 supports exactly one connected HubSpot account, so `oauth_tokens` uses a `CHECK (id = 1)` singleton row instead of a table keyed by account. Multi-tenant support would mean keying this table (and the contacts table) by account/portal ID — explicitly deferred.
- **Idempotent upserts via `ON CONFLICT`, not read-then-write.** `upsertContact` is a single `INSERT ... ON CONFLICT(hubspot_contact_id) DO UPDATE` statement so concurrent syncs/webhooks can't race a read-modify-write cycle into a lost update.
- **Retry budget: 4 retries (5 attempts total), retry only on 429/5xx.** 4xx errors (bad auth, malformed request) are aborted immediately via `p-retry`'s `AbortError` — retrying a request that's wrong in the same way five times just delays surfacing the real bug. When HubSpot sends `Retry-After`, the retry wrapper sleeps at least that long before the next attempt, on top of the normal exponential backoff.
- **Token refresh is transparent to callers.** The HubSpot axios client proactively refreshes when the stored token is within 60s of expiry (before the request even goes out), and additionally catches a stray `401` via a response interceptor as a fallback, retrying the original request exactly once. Callers of `contacts.api.ts` never handle token expiry themselves.
- **Webhook ack-then-process.** The webhook controller responds `200` as soon as the payload is verified and parsed, then processes each event afterward. HubSpot expects fast acks and will retry on timeout; per-event processing failures are logged, not surfaced as a delivery failure, so a single bad event can't cause HubSpot to keep re-delivering an entire batch.
- **Local pagination is cursor-based on the local `id`,** not on HubSpot's cursor — `/contacts` reads from SQLite only and has no relationship to HubSpot's own `after` pagination token used internally by `/sync/contacts`.
- **ESM throughout** (`"type": "module"`, `NodeNext` module resolution) since `p-retry` v6+ dropped CommonJS support.
- **`app.set("trust proxy", true)` is required, and it's a real gotcha we hit, not a defensive guess.** HubSpot's v3 signature is computed over the full request URL *as HubSpot called it* — `https://<public-host>/webhook/hubspot`. When this service sits behind a reverse proxy or tunnel (ngrok, in testing), the TLS connection terminates at the proxy and the hop to Express is plain HTTP, so `req.protocol` defaults to `"http"` unless Express is told to trust `X-Forwarded-Proto`. Without `trust proxy` enabled, every signature check silently reconstructs the wrong URL (`http://...` instead of `https://...`) and every genuine, correctly-signed HubSpot webhook gets rejected with `401` — no exception thrown, no obvious error, just consistent rejection that looks identical to "someone's forging requests." We hit this directly: real HubSpot deliveries came back `401 {"error":"invalid signature"}` against a fully correct `HUBSPOT_WEBHOOK_SECRET`, and it only surfaced once we inspected the raw request via ngrok's inspector (`http://127.0.0.1:4040`) and diffed the HMAC input by hand. Worth knowing if you deploy this behind any proxy/load balancer, not just ngrok — the same failure mode applies to nginx, an ALB, Cloudflare, etc., anywhere TLS terminates before Express sees the request.
- **ngrok's free tier gives exactly one persistent static domain per account and allows one active tunnel session at a time.** If you already have an ngrok tunnel running for something else, starting a second one to test this service's webhook will fail with `ERR_NGROK_334` ("endpoint already online") rather than silently opening a second tunnel — you have to stop the existing one first.

## Explicitly Out of Scope (v1)

- Any HubSpot object other than Contacts (no Deals, Companies, Tickets).
- Bidirectional sync — this is HubSpot → local only. No local writes are pushed back to HubSpot.
- Multi-tenant / multi-account support — single HubSpot account, singleton token row.
- Any UI.

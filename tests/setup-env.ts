import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Dummy values so config/env.ts's zod validation passes at import time.
// dotenv.config() (called inside env.ts) never overwrites vars already set
// here, so a real local .env file can't leak into the test run.
process.env.HUBSPOT_CLIENT_ID ??= "test-client-id";
process.env.HUBSPOT_CLIENT_SECRET ??= "test-client-secret";
process.env.HUBSPOT_REDIRECT_URI ??= "http://localhost:3000/auth/callback";
process.env.HUBSPOT_WEBHOOK_SECRET ??= "test-webhook-secret";

// Isolated real SQLite file per test file, never the dev database.
process.env.DATABASE_PATH = join(tmpdir(), `hubspot-integration-test-${randomUUID()}.db`);

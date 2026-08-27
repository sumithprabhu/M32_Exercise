import { db } from "./db.js";

export interface WebhookEventRow {
  id: number;
  event_id: string;
  subscription_type: string;
  object_id: string;
  payload: string;
  received_at: number;
  processed: number;
}

export interface NewWebhookEvent {
  eventId: string;
  subscriptionType: string;
  objectId: string;
  payload: string;
}

const insertStmt = db.prepare(
  `INSERT OR IGNORE INTO webhook_events (event_id, subscription_type, object_id, payload, received_at)
   VALUES (@eventId, @subscriptionType, @objectId, @payload, @receivedAt)`
);

export function insertWebhookEvent(event: NewWebhookEvent): { inserted: boolean } {
  const result = insertStmt.run({ ...event, receivedAt: Date.now() });
  return { inserted: result.changes > 0 };
}

export function markWebhookEventProcessed(eventId: string): void {
  db.prepare("UPDATE webhook_events SET processed = 1 WHERE event_id = @eventId").run({ eventId });
}

export function listWebhookEvents(limit = 50): WebhookEventRow[] {
  return db.prepare("SELECT * FROM webhook_events ORDER BY id DESC LIMIT @limit").all({ limit }) as WebhookEventRow[];
}

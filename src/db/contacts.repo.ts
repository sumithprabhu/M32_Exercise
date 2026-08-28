import { db } from "./db.js";
import type { LocalContactRecord } from "../sync/transformers.js";

export interface ContactRow {
  id: number;
  hubspot_contact_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  lifecycle_stage: string | null;
  raw_payload: string;
  created_at: number;
  updated_at: number;
}

const upsertStmt = db.prepare(
  `INSERT INTO contacts (
     hubspot_contact_id, email, first_name, last_name, lifecycle_stage, raw_payload, created_at, updated_at
   ) VALUES (
     @hubspotContactId, @email, @firstName, @lastName, @lifecycleStage, @rawPayload, @now, @now
   )
   ON CONFLICT(hubspot_contact_id) DO UPDATE SET
     email = excluded.email,
     first_name = excluded.first_name,
     last_name = excluded.last_name,
     lifecycle_stage = excluded.lifecycle_stage,
     raw_payload = excluded.raw_payload,
     updated_at = excluded.updated_at`
);

export function upsertContact(contact: LocalContactRecord): void {
  upsertStmt.run({ ...contact, now: Date.now() });
}

export interface ListContactsFilters {
  limit: number;
  after?: number;
  sort: "id_asc" | "id_desc";
  email?: string;
}

export function listContacts(filters: ListContactsFilters): ContactRow[] {
  const direction = filters.sort === "id_desc" ? "DESC" : "ASC";
  const comparator = filters.sort === "id_desc" ? "<" : ">";

  const conditions: string[] = [];
  const params: Record<string, unknown> = { limit: filters.limit };

  if (filters.after !== undefined) {
    conditions.push(`id ${comparator} @after`);
    params.after = filters.after;
  }
  if (filters.email !== undefined) {
    conditions.push("email = @email");
    params.email = filters.email;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return db
    .prepare(`SELECT * FROM contacts ${whereClause} ORDER BY id ${direction} LIMIT @limit`)
    .all(params) as ContactRow[];
}

export function getContactByHubspotId(hubspotContactId: string): ContactRow | undefined {
  return db
    .prepare("SELECT * FROM contacts WHERE hubspot_contact_id = @hubspotContactId")
    .get({ hubspotContactId }) as ContactRow | undefined;
}

export function getContactById(id: number): ContactRow | undefined {
  return db.prepare("SELECT * FROM contacts WHERE id = @id").get({ id }) as ContactRow | undefined;
}

const deleteByHubspotIdStmt = db.prepare("DELETE FROM contacts WHERE hubspot_contact_id = @hubspotContactId");

// Deleting a hubspot_contact_id that isn't present locally is a no-op (0 rows
// affected), which makes this safe to call idempotently on retried webhook deliveries.
export function deleteContactByHubspotId(hubspotContactId: string): void {
  deleteByHubspotIdStmt.run({ hubspotContactId });
}

// Full-sync reconciliation: removes any local contact whose hubspot_contact_id
// wasn't present in the given set (i.e. no longer returned by HubSpot's contacts
// list, meaning it was deleted/archived upstream). Only safe to call after a
// complete, uninterrupted full pull -- a partial page fetch would look identical
// to a bunch of deletions and wrongly wipe contacts HubSpot still has.
export function deleteContactsNotIn(hubspotContactIds: Iterable<string>): number {
  const keep = new Set(hubspotContactIds);
  const all = db.prepare("SELECT hubspot_contact_id FROM contacts").all() as { hubspot_contact_id: string }[];
  const toDelete = all.filter((row) => !keep.has(row.hubspot_contact_id));
  for (const row of toDelete) {
    deleteByHubspotIdStmt.run({ hubspotContactId: row.hubspot_contact_id });
  }
  return toDelete.length;
}

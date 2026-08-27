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
}

export function listContacts(filters: ListContactsFilters): ContactRow[] {
  const direction = filters.sort === "id_desc" ? "DESC" : "ASC";
  const comparator = filters.sort === "id_desc" ? "<" : ">";

  if (filters.after !== undefined) {
    return db
      .prepare(`SELECT * FROM contacts WHERE id ${comparator} @after ORDER BY id ${direction} LIMIT @limit`)
      .all({ after: filters.after, limit: filters.limit }) as ContactRow[];
  }

  return db
    .prepare(`SELECT * FROM contacts ORDER BY id ${direction} LIMIT @limit`)
    .all({ limit: filters.limit }) as ContactRow[];
}

export function getContactByHubspotId(hubspotContactId: string): ContactRow | undefined {
  return db
    .prepare("SELECT * FROM contacts WHERE hubspot_contact_id = @hubspotContactId")
    .get({ hubspotContactId }) as ContactRow | undefined;
}

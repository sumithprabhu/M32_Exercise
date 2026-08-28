import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/db.js";
import { upsertContact, getContactByHubspotId } from "../../src/db/contacts.repo.js";
import type { LocalContactRecord } from "../../src/sync/transformers.js";

describe("contacts.repo upsertContact (real SQLite file)", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM contacts").run();
  });

  it("upserting the same hubspot_contact_id twice keeps exactly one row with the latest values", () => {
    const first: LocalContactRecord = {
      hubspotContactId: "1001",
      email: "first@example.com",
      firstName: "First",
      lastName: "Version",
      lifecycleStage: "lead",
      rawPayload: JSON.stringify({ id: "1001", version: 1 }),
    };
    const second: LocalContactRecord = {
      hubspotContactId: "1001",
      email: "second@example.com",
      firstName: "Second",
      lastName: "Version",
      lifecycleStage: "customer",
      rawPayload: JSON.stringify({ id: "1001", version: 2 }),
    };

    upsertContact(first);
    upsertContact(second);

    const { count } = db
      .prepare("SELECT COUNT(*) as count FROM contacts WHERE hubspot_contact_id = ?")
      .get("1001") as { count: number };
    expect(count).toBe(1);

    const row = getContactByHubspotId("1001");
    expect(row).toBeDefined();
    expect(row?.email).toBe("second@example.com");
    expect(row?.first_name).toBe("Second");
    expect(row?.last_name).toBe("Version");
    expect(row?.lifecycle_stage).toBe("customer");
  });

  it("keeps distinct hubspot_contact_ids as separate rows", () => {
    upsertContact({
      hubspotContactId: "2001",
      email: "a@example.com",
      firstName: "A",
      lastName: "One",
      lifecycleStage: null,
      rawPayload: "{}",
    });
    upsertContact({
      hubspotContactId: "2002",
      email: "b@example.com",
      firstName: "B",
      lastName: "Two",
      lifecycleStage: null,
      rawPayload: "{}",
    });

    const { count } = db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number };
    expect(count).toBe(2);
  });
});

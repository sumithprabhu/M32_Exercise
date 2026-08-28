import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../src/db/db.js";
import { upsertContact, getContactByHubspotId } from "../../src/db/contacts.repo.js";
import { fetchContactsPage } from "../../src/hubspot/contacts.api.js";
import { runContactSync } from "../../src/sync/contact-sync.service.js";

vi.mock("../../src/hubspot/contacts.api.js", () => ({
  fetchContactsPage: vi.fn(),
}));

function hubspotContact(id: string, email: string) {
  return {
    id,
    properties: { email, firstname: null, lastname: null, lifecyclestage: null, lastmodifieddate: null },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("runContactSync deletion reconciliation", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM contacts").run();
    vi.mocked(fetchContactsPage).mockReset();
  });

  it("removes a local contact that no longer comes back from a full HubSpot pull", async () => {
    upsertContact({
      hubspotContactId: "5001",
      email: "keep@example.com",
      firstName: "Keep",
      lastName: "Me",
      lifecycleStage: null,
      rawPayload: "{}",
    });
    upsertContact({
      hubspotContactId: "5002",
      email: "gone@example.com",
      firstName: "Gone",
      lastName: "Contact",
      lifecycleStage: null,
      rawPayload: "{}",
    });

    // HubSpot's full pull now only returns 5001 -- 5002 was deleted upstream.
    vi.mocked(fetchContactsPage).mockResolvedValueOnce({
      results: [hubspotContact("5001", "keep@example.com")],
      nextAfter: null,
    });

    const result = await runContactSync();

    expect(result).toEqual({ pagesFetched: 1, contactsUpserted: 1, contactsDeleted: 1 });
    expect(getContactByHubspotId("5001")).toBeDefined();
    expect(getContactByHubspotId("5002")).toBeUndefined();
  });

  it("does not delete anything if the sync throws partway through a multi-page pull", async () => {
    upsertContact({
      hubspotContactId: "6001",
      email: "safe@example.com",
      firstName: "Safe",
      lastName: "Contact",
      lifecycleStage: null,
      rawPayload: "{}",
    });

    // First page succeeds (doesn't include 6001, which would normally mean
    // "delete it"), second page fails -- the sync should abort before
    // reconciling deletions off an incomplete pull.
    vi.mocked(fetchContactsPage)
      .mockResolvedValueOnce({ results: [hubspotContact("9999", "other@example.com")], nextAfter: "cursor-1" })
      .mockRejectedValueOnce(new Error("network blip"));

    await expect(runContactSync()).rejects.toThrow("network blip");

    expect(getContactByHubspotId("6001")).toBeDefined();
  });
});

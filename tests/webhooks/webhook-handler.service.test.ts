import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../src/db/db.js";
import { upsertContact, getContactByHubspotId } from "../../src/db/contacts.repo.js";
import { fetchContactById } from "../../src/hubspot/contacts.api.js";
import { applyWebhookEvent } from "../../src/webhooks/webhook-handler.service.js";

vi.mock("../../src/hubspot/contacts.api.js", () => ({
  fetchContactById: vi.fn(),
}));

describe("applyWebhookEvent", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM contacts").run();
    vi.mocked(fetchContactById).mockReset();
  });

  it("removes the local row on a contact.deletion event without calling HubSpot", async () => {
    upsertContact({
      hubspotContactId: "7001",
      email: "todelete@example.com",
      firstName: "To",
      lastName: "Delete",
      lifecycleStage: null,
      rawPayload: "{}",
    });
    expect(getContactByHubspotId("7001")).toBeDefined();

    await applyWebhookEvent({ eventId: "evt-1", subscriptionType: "contact.deletion", objectId: "7001" });

    expect(getContactByHubspotId("7001")).toBeUndefined();
    expect(fetchContactById).not.toHaveBeenCalled();
  });

  it("is idempotent: a deletion event for an id already gone locally is a safe no-op", async () => {
    await expect(
      applyWebhookEvent({ eventId: "evt-2", subscriptionType: "contact.deletion", objectId: "does-not-exist" })
    ).resolves.not.toThrow();
  });

  it("refetches and upserts on a non-deletion event", async () => {
    vi.mocked(fetchContactById).mockResolvedValueOnce({
      id: "7002",
      properties: { email: "changed@example.com", firstname: "Changed", lastname: null, lifecyclestage: null },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await applyWebhookEvent({ eventId: "evt-3", subscriptionType: "contact.propertyChange", objectId: "7002" });

    expect(getContactByHubspotId("7002")?.email).toBe("changed@example.com");
  });
});

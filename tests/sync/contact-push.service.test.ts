import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "../../src/db/db.js";
import { upsertContact, getContactByHubspotId } from "../../src/db/contacts.repo.js";
import { fetchContactById, updateContactProperties } from "../../src/hubspot/contacts.api.js";
import { pushContactUpdate, ContactNotFoundError, StaleWriteConflictError } from "../../src/sync/contact-push.service.js";

vi.mock("../../src/hubspot/contacts.api.js", () => ({
  fetchContactById: vi.fn(),
  updateContactProperties: vi.fn(),
}));

function seedLocalContact(updatedAtMs: number) {
  upsertContact({
    hubspotContactId: "3001",
    email: "old@example.com",
    firstName: "Old",
    lastName: "Name",
    lifecycleStage: "lead",
    rawPayload: "{}",
  });
  db.prepare("UPDATE contacts SET updated_at = ? WHERE hubspot_contact_id = ?").run(updatedAtMs, "3001");
  return getContactByHubspotId("3001")!;
}

describe("pushContactUpdate", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM contacts").run();
    vi.mocked(fetchContactById).mockReset();
    vi.mocked(updateContactProperties).mockReset();
  });

  it("pushes the change to HubSpot and refreshes the local row when the edit is not stale", async () => {
    const localUpdatedAt = Date.now() - 60_000; // local row synced a minute ago
    const local = seedLocalContact(localUpdatedAt);

    vi.mocked(fetchContactById)
      // 1st call: current remote state, used for the conflict check
      .mockResolvedValueOnce({
        id: "3001",
        properties: { email: "old@example.com", lastmodifieddate: new Date(localUpdatedAt - 5_000).toISOString() },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      // 2nd call: refetch immediately after the push
      .mockResolvedValueOnce({
        id: "3001",
        properties: {
          email: "new@example.com",
          firstname: "New",
          lastmodifieddate: new Date().toISOString(),
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    vi.mocked(updateContactProperties).mockResolvedValueOnce(undefined);

    const result = await pushContactUpdate(local.id, { email: "new@example.com" });

    expect(updateContactProperties).toHaveBeenCalledWith("3001", { email: "new@example.com" });
    expect(result.email).toBe("new@example.com");
    expect(result.first_name).toBe("New");

    const { count } = db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number };
    expect(count).toBe(1);
  });

  it("rejects with a conflict when HubSpot's lastmodifieddate is newer than the local edit baseline", async () => {
    const localUpdatedAt = Date.now() - 60_000;
    const local = seedLocalContact(localUpdatedAt);

    vi.mocked(fetchContactById).mockResolvedValueOnce({
      id: "3001",
      properties: {
        email: "someone-else-edited-in-hubspot@example.com",
        lastmodifieddate: new Date().toISOString(), // newer than localUpdatedAt
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(pushContactUpdate(local.id, { email: "my-change@example.com" })).rejects.toBeInstanceOf(
      StaleWriteConflictError
    );

    // The whole point of the check: never call HubSpot's write endpoint, and
    // never touch the local row, once a conflict is detected.
    expect(updateContactProperties).not.toHaveBeenCalled();
    const unchanged = getContactByHubspotId("3001")!;
    expect(unchanged.email).toBe("old@example.com");
  });

  it("throws ContactNotFoundError for an unknown local id", async () => {
    await expect(pushContactUpdate(999_999, { email: "x@example.com" })).rejects.toBeInstanceOf(ContactNotFoundError);
    expect(fetchContactById).not.toHaveBeenCalled();
  });
});

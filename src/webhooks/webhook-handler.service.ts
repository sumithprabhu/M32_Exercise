import { fetchContactById } from "../hubspot/contacts.api.js";
import { mapHubspotContactToLocal } from "../sync/transformers.js";
import { upsertContact } from "../db/contacts.repo.js";
import { logger } from "../utils/logger.js";

export interface HubspotWebhookEvent {
  eventId: string;
  subscriptionType: string;
  objectId: string;
}

export async function applyWebhookEvent(event: HubspotWebhookEvent): Promise<void> {
  if (event.subscriptionType.startsWith("contact.deletion")) {
    logger.info("skipping refetch for deletion event", { eventId: event.eventId, objectId: event.objectId });
    return;
  }

  // Webhook payloads carry only the single property that changed, not the full
  // object — refetching keeps the local row consistent with HubSpot's current
  // state instead of partially patching it from a fragment.
  //
  // This also makes redundant deliveries safe by construction: when
  // contact-push.service.ts pushes a local edit to HubSpot, HubSpot fires a
  // webhook for that same change, which lands here and refetches+upserts again.
  // Since upsertContact is an idempotent ON CONFLICT DO UPDATE (see
  // tests/db/contacts.repo.test.ts), reprocessing the same eventual state twice
  // is a harmless no-op, not a duplicate row or a correctness bug.
  const contact = await fetchContactById(event.objectId);
  upsertContact(mapHubspotContactToLocal(contact));
}

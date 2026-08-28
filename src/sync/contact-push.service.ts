import { fetchContactById, updateContactProperties } from "../hubspot/contacts.api.js";
import { getContactById, upsertContact, type ContactRow } from "../db/contacts.repo.js";
import { mapHubspotContactToLocal } from "./transformers.js";

export class ContactNotFoundError extends Error {}

export class StaleWriteConflictError extends Error {
  constructor(
    public readonly hubspotLastModified: string,
    public readonly localUpdatedAt: number
  ) {
    super("Local write is based on stale data; HubSpot has a newer version of this contact.");
  }
}

export interface ContactPushFields {
  email?: string;
  first_name?: string;
  last_name?: string;
  lifecycle_stage?: string;
}

const LOCAL_TO_HUBSPOT_PROPERTY: Record<keyof ContactPushFields, string> = {
  email: "email",
  first_name: "firstname",
  last_name: "lastname",
  lifecycle_stage: "lifecyclestage",
};

export async function pushContactUpdate(localId: number, fields: ContactPushFields): Promise<ContactRow> {
  const localContact = getContactById(localId);
  if (!localContact) {
    throw new ContactNotFoundError(`No local contact with id ${localId}`);
  }

  const remoteContact = await fetchContactById(localContact.hubspot_contact_id);

  // Conflict check: compare HubSpot's current lastmodifieddate against our local
  // updated_at (when we last wrote this row). Comparing HubSpot's clock to our own
  // wall-clock is an approximation, not a perfectly synchronized comparison -- but
  // it's a reliable heuristic for "did HubSpot change since we last saw this contact,"
  // and it works for every row unconditionally (unlike comparing against a
  // previously-stored lastmodifieddate, which older synced rows won't have).
  const remoteLastModifiedMs = remoteContact.properties.lastmodifieddate
    ? Date.parse(remoteContact.properties.lastmodifieddate)
    : 0;

  if (remoteLastModifiedMs > localContact.updated_at) {
    throw new StaleWriteConflictError(remoteContact.properties.lastmodifieddate ?? "", localContact.updated_at);
  }

  const hubspotProperties: Record<string, string> = {};
  for (const key of Object.keys(LOCAL_TO_HUBSPOT_PROPERTY) as (keyof ContactPushFields)[]) {
    const value = fields[key];
    if (value !== undefined) {
      hubspotProperties[LOCAL_TO_HUBSPOT_PROPERTY[key]] = value;
    }
  }

  await updateContactProperties(localContact.hubspot_contact_id, hubspotProperties);

  // Refetch full state rather than trust the PATCH response shape -- same principle
  // applyWebhookEvent uses, so there's one canonical "HubSpot contact -> local row"
  // mapping path (mapHubspotContactToLocal) instead of a second parallel one.
  const refreshed = await fetchContactById(localContact.hubspot_contact_id);
  upsertContact(mapHubspotContactToLocal(refreshed));

  return getContactById(localId)!;
}

import type { HubspotContactResult } from "../hubspot/contacts.api.js";

export interface LocalContactRecord {
  hubspotContactId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  lifecycleStage: string | null;
  rawPayload: string;
}

export function mapHubspotContactToLocal(raw: HubspotContactResult): LocalContactRecord {
  return {
    hubspotContactId: raw.id,
    email: raw.properties.email ?? null,
    firstName: raw.properties.firstname ?? null,
    lastName: raw.properties.lastname ?? null,
    lifecycleStage: raw.properties.lifecyclestage ?? null,
    rawPayload: JSON.stringify(raw),
  };
}

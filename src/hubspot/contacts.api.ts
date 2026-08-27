import { hubspotClient } from "./hubspot.client.js";
import { withHubspotRetry } from "../utils/retry.js";

const CONTACT_PROPERTIES = ["email", "firstname", "lastname", "lifecyclestage"];
const PAGE_SIZE = 100;

export interface HubspotContactResult {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface HubspotContactsPage {
  results: HubspotContactResult[];
  nextAfter: string | null;
}

interface HubspotContactsListResponse {
  results: HubspotContactResult[];
  paging?: { next?: { after?: string } };
}

export async function fetchContactsPage(after?: string): Promise<HubspotContactsPage> {
  const response = await withHubspotRetry(() =>
    hubspotClient.get<HubspotContactsListResponse>("/crm/v3/objects/contacts", {
      params: {
        limit: PAGE_SIZE,
        after,
        properties: CONTACT_PROPERTIES.join(","),
      },
    })
  );

  return {
    results: response.data.results,
    nextAfter: response.data.paging?.next?.after ?? null,
  };
}

export async function fetchContactById(hubspotContactId: string): Promise<HubspotContactResult> {
  const response = await withHubspotRetry(() =>
    hubspotClient.get<HubspotContactResult>(`/crm/v3/objects/contacts/${hubspotContactId}`, {
      params: { properties: CONTACT_PROPERTIES.join(",") },
    })
  );
  return response.data;
}

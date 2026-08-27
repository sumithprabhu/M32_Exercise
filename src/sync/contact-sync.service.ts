import { fetchContactsPage } from "../hubspot/contacts.api.js";
import { mapHubspotContactToLocal } from "./transformers.js";
import { upsertContact } from "../db/contacts.repo.js";
import { logger } from "../utils/logger.js";

export interface ContactSyncResult {
  pagesFetched: number;
  contactsUpserted: number;
}

export async function runContactSync(): Promise<ContactSyncResult> {
  let after: string | undefined;
  let pagesFetched = 0;
  let contactsUpserted = 0;

  do {
    const page = await fetchContactsPage(after);
    for (const rawContact of page.results) {
      upsertContact(mapHubspotContactToLocal(rawContact));
      contactsUpserted += 1;
    }
    pagesFetched += 1;
    after = page.nextAfter ?? undefined;
  } while (after);

  logger.info("contact sync complete", { pagesFetched, contactsUpserted });
  return { pagesFetched, contactsUpserted };
}

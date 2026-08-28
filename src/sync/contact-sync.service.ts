import { fetchContactsPage } from "../hubspot/contacts.api.js";
import { mapHubspotContactToLocal } from "./transformers.js";
import { upsertContact, deleteContactsNotIn } from "../db/contacts.repo.js";
import { logger } from "../utils/logger.js";

export interface ContactSyncResult {
  pagesFetched: number;
  contactsUpserted: number;
  contactsDeleted: number;
}

export async function runContactSync(): Promise<ContactSyncResult> {
  let after: string | undefined;
  let pagesFetched = 0;
  let contactsUpserted = 0;
  const seenHubspotIds = new Set<string>();

  do {
    const page = await fetchContactsPage(after);
    for (const rawContact of page.results) {
      const localContact = mapHubspotContactToLocal(rawContact);
      upsertContact(localContact);
      seenHubspotIds.add(localContact.hubspotContactId);
      contactsUpserted += 1;
    }
    pagesFetched += 1;
    after = page.nextAfter ?? undefined;
  } while (after);

  // Only runs once every page has been fetched successfully -- if the loop above
  // throws partway through, this line never executes, so a failed sync can't be
  // mistaken for "everything else was deleted."
  const contactsDeleted = deleteContactsNotIn(seenHubspotIds);

  logger.info("contact sync complete", { pagesFetched, contactsUpserted, contactsDeleted });
  return { pagesFetched, contactsUpserted, contactsDeleted };
}

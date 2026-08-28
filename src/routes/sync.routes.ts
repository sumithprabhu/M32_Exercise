import { Router } from "express";
import { runContactSync } from "../sync/contact-sync.service.js";

export const syncRouter = Router();

/**
 * @openapi
 * /sync/contacts:
 *   post:
 *     summary: Pull all Contacts from HubSpot into the local database
 *     description: Paginates through every HubSpot contact and idempotently upserts each into the local `contacts` table, keyed on `hubspot_contact_id`. Safe to call repeatedly — re-running produces no duplicates.
 *     tags: [Sync]
 *     responses:
 *       '200':
 *         description: Sync completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pagesFetched:
 *                   type: integer
 *                   example: 1
 *                 contactsUpserted:
 *                   type: integer
 *                   example: 2
 *             example:
 *               pagesFetched: 1
 *               contactsUpserted: 2
 *       '502':
 *         description: HubSpot request failed after exhausting the retry budget (429/5xx).
 */
syncRouter.post("/contacts", async (_req, res, next) => {
  try {
    const result = await runContactSync();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

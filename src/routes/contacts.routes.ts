import { Router } from "express";
import { z } from "zod";
import { listContacts } from "../db/contacts.repo.js";
import {
  pushContactUpdate,
  ContactNotFoundError,
  StaleWriteConflictError,
} from "../sync/contact-push.service.js";

export const contactsRouter = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  after: z.coerce.number().int().positive().optional(),
  sort: z.enum(["id_asc", "id_desc"]).default("id_asc"),
  email: z.string().email().optional(),
});

/**
 * @openapi
 * /contacts:
 *   get:
 *     summary: List locally synced contacts
 *     description: Reads from the local SQLite cache only — independent of HubSpot's own pagination cursor used internally by POST /sync/contacts.
 *     tags: [Contacts]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: after
 *         schema: { type: integer }
 *         description: Local `id` cursor; returns rows after (or before, if sort=id_desc) this id.
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [id_asc, id_desc], default: id_asc }
 *       - in: query
 *         name: email
 *         schema: { type: string, format: email }
 *         description: Exact-match filter, case-sensitive.
 *         example: bh@hubspot.com
 *     responses:
 *       '200':
 *         description: Contacts matching the given filters.
 *         content:
 *           application/json:
 *             example:
 *               results:
 *                 - id: 1
 *                   hubspot_contact_id: "541935488729"
 *                   email: emailmaria@hubspot.com
 *                   first_name: Maria
 *                   last_name: "Johnson (Sample Contact)"
 *                   lifecycle_stage: null
 *                   created_at: 1787842661022
 *                   updated_at: 1787842661022
 *                 - id: 2
 *                   hubspot_contact_id: "541935876822"
 *                   email: bh@hubspot.com
 *                   first_name: Brian
 *                   last_name: "Halligan (Sample Contact)"
 *                   lifecycle_stage: null
 *                   created_at: 1787842661030
 *                   updated_at: 1787842661030
 *               count: 2
 *       '400':
 *         description: Invalid query parameters.
 */
contactsRouter.get("/", (req, res, next) => {
  try {
    const filters = listQuerySchema.parse(req.query);
    const contacts = listContacts(filters);
    res.json({ results: contacts, count: contacts.length });
  } catch (err) {
    next(err);
  }
});

const patchParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const patchBodySchema = z
  .object({
    email: z.string().email().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    lifecycle_stage: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

/**
 * @openapi
 * /contacts/{id}:
 *   patch:
 *     summary: Push a local edit to HubSpot (bidirectional sync)
 *     description: >
 *       Pushes the given fields to HubSpot via PATCH /crm/v3/objects/contacts/{id}, then refetches and
 *       refreshes the local row from HubSpot's response. `id` is the local autoincrement id from GET
 *       /contacts, not the HubSpot contact id. Conflict policy is last-write-wins by timestamp: if
 *       HubSpot's `lastmodifieddate` for this contact is newer than the local row's `updated_at`, the
 *       write is rejected with 409 rather than silently overwriting an unseen remote change. If the
 *       HubSpot call fails, the local row is left untouched.
 *     tags: [Contacts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 2
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               email: { type: string, format: email }
 *               first_name: { type: string }
 *               last_name: { type: string }
 *               lifecycle_stage: { type: string }
 *           example:
 *             email: bh.pushed.from.local@hubspot.com
 *             lifecycle_stage: customer
 *     responses:
 *       '200':
 *         description: Push succeeded; local row refreshed from HubSpot's current state. Real response captured against a HubSpot test account.
 *         content:
 *           application/json:
 *             example:
 *               id: 2
 *               hubspot_contact_id: "541935876822"
 *               email: bh.pushed.from.local@hubspot.com
 *               first_name: Brian
 *               last_name: "Halligan (Sample Contact)"
 *               lifecycle_stage: customer
 *               created_at: 1787842651856
 *               updated_at: 1787891418954
 *       '400':
 *         description: No fields provided, or a field failed validation (e.g. malformed email).
 *       '404':
 *         description: No local contact with the given id.
 *         content:
 *           application/json:
 *             example:
 *               error: contact_not_found
 *       '409':
 *         description: >
 *           Rejected: HubSpot's lastmodifieddate for this contact is newer than the local edit's
 *           baseline. Real conflict captured live during testing — re-sync and retry. Caller should
 *           call POST /sync/contacts (or re-GET /contacts) before retrying the PATCH.
 *         content:
 *           application/json:
 *             example:
 *               error: stale_write_conflict
 *               message: "HubSpot has a newer version of this contact than the one this edit was based on. Re-sync (GET /contacts or POST /sync/contacts) and retry."
 *               hubspotLastModified: "2026-08-27T19:52:47.843Z"
 */
contactsRouter.patch("/:id", async (req, res, next) => {
  try {
    const { id } = patchParamsSchema.parse(req.params);
    const fields = patchBodySchema.parse(req.body);
    const updated = await pushContactUpdate(id, fields);
    res.json(updated);
  } catch (err) {
    if (err instanceof ContactNotFoundError) {
      res.status(404).json({ error: "contact_not_found" });
      return;
    }
    if (err instanceof StaleWriteConflictError) {
      res.status(409).json({
        error: "stale_write_conflict",
        message:
          "HubSpot has a newer version of this contact than the one this edit was based on. Re-sync (GET /contacts or POST /sync/contacts) and retry.",
        hubspotLastModified: err.hubspotLastModified,
      });
      return;
    }
    next(err);
  }
});

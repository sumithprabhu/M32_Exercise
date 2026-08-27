import { Router } from "express";
import { z } from "zod";
import { listContacts } from "../db/contacts.repo.js";

export const contactsRouter = Router();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  after: z.coerce.number().int().positive().optional(),
  sort: z.enum(["id_asc", "id_desc"]).default("id_asc"),
});

contactsRouter.get("/", (req, res, next) => {
  try {
    const filters = listQuerySchema.parse(req.query);
    const contacts = listContacts(filters);
    res.json({ results: contacts, count: contacts.length });
  } catch (err) {
    next(err);
  }
});

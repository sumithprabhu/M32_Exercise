import { Router } from "express";
import { runContactSync } from "../sync/contact-sync.service.js";

export const syncRouter = Router();

syncRouter.post("/contacts", async (_req, res, next) => {
  try {
    const result = await runContactSync();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

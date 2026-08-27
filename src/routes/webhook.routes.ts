import { Router } from "express";
import { handleHubspotWebhook } from "../webhooks/hubspot-webhook.controller.js";

export const webhookRouter = Router();

webhookRouter.post("/hubspot", handleHubspotWebhook);

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyHubspotSignature } from "./webhook-signature.js";
import { insertWebhookEvent, markWebhookEventProcessed } from "../db/webhook-events.repo.js";
import { applyWebhookEvent } from "./webhook-handler.service.js";
import { logger } from "../utils/logger.js";

const webhookEventSchema = z.object({
  eventId: z.union([z.string(), z.number()]).transform(String),
  subscriptionType: z.string(),
  objectId: z.union([z.string(), z.number()]).transform(String),
});

const webhookPayloadSchema = z.array(webhookEventSchema);

export async function handleHubspotWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!verifyHubspotSignature(req)) {
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    const events = webhookPayloadSchema.parse(req.body);

    // Ack fast — HubSpot expects a prompt 2xx and retries deliveries that time out.
    // Per-event failures below are logged, not surfaced to HubSpot as a delivery failure.
    res.status(200).json({ received: events.length });

    for (const event of events) {
      const { inserted } = insertWebhookEvent({
        eventId: event.eventId,
        subscriptionType: event.subscriptionType,
        objectId: event.objectId,
        payload: JSON.stringify(event),
      });
      if (!inserted) continue;

      try {
        await applyWebhookEvent(event);
        markWebhookEventProcessed(event.eventId);
      } catch (err) {
        logger.error("failed to apply webhook event", { eventId: event.eventId, error: String(err) });
      }
    }
  } catch (err) {
    next(err);
  }
}

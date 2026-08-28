import { Router } from "express";
import { handleHubspotWebhook } from "../webhooks/hubspot-webhook.controller.js";

export const webhookRouter = Router();

/**
 * @openapi
 * /webhook/hubspot:
 *   post:
 *     summary: Receive HubSpot Contact webhook events
 *     description: >
 *       Verifies the X-HubSpot-Signature-v3 HMAC (over method+url+rawBody+timestamp) before doing
 *       anything else, with a 5-minute replay window. Idempotent on eventId via the webhook_events
 *       unique index. On a contact.deletion event, removes the local row (deleted contacts can't be
 *       refetched). On any other event, refetches the full contact from HubSpot rather than trusting
 *       the (partial) webhook payload, then upserts it. Meant to be called by HubSpot, not manually —
 *       a request without a valid HMAC will always be rejected, which is the one thing actually worth
 *       trying from this UI.
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *           example:
 *             - eventId: 4101286121
 *               subscriptionId: 7562680
 *               portalId: 247187887
 *               appId: 50780459
 *               occurredAt: 1787843156000
 *               subscriptionType: contact.propertyChange
 *               attemptNumber: 1
 *               objectId: 541935488729
 *               propertyName: email
 *               propertyValue: emailmaria+webhook-test-2@hubspot.com
 *               changeSource: INTEGRATION
 *               sourceId: "50780459"
 *     responses:
 *       '200':
 *         description: Signature verified and payload accepted; events are processed after responding.
 *         content:
 *           application/json:
 *             example:
 *               received: 1
 *       '401':
 *         description: Missing or invalid signature. Real observed response — any request sent from this UI without a genuine HubSpot HMAC will get exactly this.
 *         content:
 *           application/json:
 *             example:
 *               error: invalid signature
 */
webhookRouter.post("/hubspot", handleHubspotWebhook);

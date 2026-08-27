import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { config } from "../config/env.js";

const SIGNATURE_HEADER = "x-hubspot-signature-v3";
const TIMESTAMP_HEADER = "x-hubspot-request-timestamp";
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export function verifyHubspotSignature(req: Request): boolean {
  const signature = req.header(SIGNATURE_HEADER);
  const timestamp = req.header(TIMESTAMP_HEADER);
  const rawBody = req.rawBody;

  if (!signature || !timestamp || !rawBody) return false;

  const timestampMs = Number(timestamp);
  if (Number.isNaN(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
    return false;
  }

  // v3 signing string per HubSpot docs: method + full request URI + raw body + timestamp.
  // req.protocol/req.get("host") must reflect the exact externally-visible URL HubSpot
  // called (set `app.set("trust proxy", ...)` if deployed behind a reverse proxy/tunnel).
  const requestUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const sourceString = `${req.method}${requestUrl}${rawBody.toString("utf-8")}${timestamp}`;
  const expectedSignature = createHmac("sha256", config.HUBSPOT_WEBHOOK_SECRET)
    .update(sourceString)
    .digest("base64");

  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

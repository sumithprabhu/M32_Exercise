import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import type { Request } from "express";
import { verifyHubspotSignature } from "../../src/webhooks/webhook-signature.js";
import { config } from "../../src/config/env.js";

function sign(method: string, url: string, body: string, timestamp: string): string {
  return createHmac("sha256", config.HUBSPOT_WEBHOOK_SECRET)
    .update(`${method}${url}${body}${timestamp}`)
    .digest("base64");
}

function buildRequest(opts: {
  host: string;
  originalUrl: string;
  rawBody: Buffer;
  timestamp: string;
  signature?: string;
}): Request {
  return {
    method: "POST",
    protocol: "https",
    originalUrl: opts.originalUrl,
    rawBody: opts.rawBody,
    header: (name: string) => {
      const key = name.toLowerCase();
      if (key === "x-hubspot-signature-v3") return opts.signature;
      if (key === "x-hubspot-request-timestamp") return opts.timestamp;
      return undefined;
    },
    get: (name: string) => (name.toLowerCase() === "host" ? opts.host : undefined),
  } as unknown as Request;
}

describe("verifyHubspotSignature", () => {
  const host = "example.ngrok-free.dev";
  const originalUrl = "/webhook/hubspot";
  const body = JSON.stringify([{ eventId: 1, subscriptionType: "contact.propertyChange", objectId: "541935488729" }]);
  const timestamp = String(Date.now());
  const fullUrl = `https://${host}${originalUrl}`;

  it("accepts a correctly signed request", () => {
    const signature = sign("POST", fullUrl, body, timestamp);
    const req = buildRequest({ host, originalUrl, rawBody: Buffer.from(body), timestamp, signature });

    expect(verifyHubspotSignature(req)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const signature = sign("POST", fullUrl, body, timestamp);
    const lastChar = signature.at(-1);
    const tampered = signature.slice(0, -1) + (lastChar === "A" ? "B" : "A");
    const req = buildRequest({ host, originalUrl, rawBody: Buffer.from(body), timestamp, signature: tampered });

    expect(verifyHubspotSignature(req)).toBe(false);
  });

  it("rejects when the body was tampered with after signing", () => {
    const signature = sign("POST", fullUrl, body, timestamp);
    const req = buildRequest({
      host,
      originalUrl,
      rawBody: Buffer.from(body.replace("541935488729", "999999999999")),
      timestamp,
      signature,
    });

    expect(verifyHubspotSignature(req)).toBe(false);
  });

  it("rejects a request with no signature header at all", () => {
    const req = buildRequest({ host, originalUrl, rawBody: Buffer.from(body), timestamp, signature: undefined });

    expect(verifyHubspotSignature(req)).toBe(false);
  });

  it("rejects a stale timestamp outside the replay window", () => {
    const staleTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 minutes old
    const signature = sign("POST", fullUrl, body, staleTimestamp);
    const req = buildRequest({ host, originalUrl, rawBody: Buffer.from(body), timestamp: staleTimestamp, signature });

    expect(verifyHubspotSignature(req)).toBe(false);
  });
});

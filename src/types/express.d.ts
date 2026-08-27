import "express";

declare module "express-serve-static-core" {
  interface Request {
    // Populated by the express.json() verify hook so webhook signature
    // verification can HMAC the exact bytes HubSpot signed, not a re-serialized copy.
    rawBody?: Buffer;
  }
}

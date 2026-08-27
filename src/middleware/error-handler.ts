import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import axios from "axios";
import { logger } from "../utils/logger.js";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    logger.error("error occurred after response was sent", { path: req.originalUrl, error: String(err) });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: "validation_error", issues: err.issues });
    return;
  }

  if (axios.isAxiosError(err)) {
    const upstreamStatus = err.response?.status;
    logger.error("upstream HubSpot request failed", { path: req.originalUrl, status: upstreamStatus });
    res.status(502).json({ error: "hubspot_request_failed" });
    return;
  }

  logger.error("unhandled error", { path: req.originalUrl, error: err instanceof Error ? err.stack : String(err) });
  res.status(500).json({ error: "internal_error" });
}

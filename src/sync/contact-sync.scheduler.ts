import { runContactSync } from "./contact-sync.service.js";
import { logger } from "../utils/logger.js";

export function startContactSyncScheduler(intervalMinutes: number): NodeJS.Timeout | null {
  if (intervalMinutes <= 0) return null;

  const intervalMs = intervalMinutes * 60_000;
  logger.info("contact sync scheduler started", { intervalMinutes });

  return setInterval(() => {
    runContactSync().catch((error) => {
      logger.error("scheduled contact sync failed", { error: String(error) });
    });
  }, intervalMs);
}

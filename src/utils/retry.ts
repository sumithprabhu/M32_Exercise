import pRetry, { AbortError } from "p-retry";
import axios from "axios";
import { logger } from "./logger.js";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null;
  const header = error.response?.headers?.["retry-after"];
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

/**
 * HubSpot rate limits (429) and occasional 5xx blips are worth retrying; a 4xx
 * validation/auth error is not — retrying it just burns attempts before failing
 * the same way, so it's aborted immediately instead of consuming the budget.
 */
export async function withHubspotRetry<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (error) {
        if (axios.isAxiosError(error) && error.response && !RETRYABLE_STATUS_CODES.has(error.response.status)) {
          throw new AbortError(error);
        }
        throw error;
      }
    },
    {
      retries: 4, // 4 retries + 1 initial attempt = 5 attempts max, per spec
      factor: 2,
      minTimeout: 500,
      maxTimeout: 15_000,
      randomize: true,
      onFailedAttempt: async (error) => {
        logger.warn("hubspot request failed, retrying", {
          attempt: error.attemptNumber,
          retriesLeft: error.retriesLeft,
        });
        const retryAfterMs = parseRetryAfterMs(error);
        if (retryAfterMs !== null) {
          await sleep(retryAfterMs);
        }
      },
    }
  );
}

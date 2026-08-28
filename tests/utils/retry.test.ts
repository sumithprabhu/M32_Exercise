import { describe, it, expect, vi } from "vitest";
import { withHubspotRetry } from "../../src/utils/retry.js";

function axiosError(status: number): Error & { isAxiosError: true; response: { status: number; headers: Record<string, string> } } {
  const error = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: true;
    response: { status: number; headers: Record<string, string> };
  };
  error.isAxiosError = true;
  error.response = { status, headers: {} };
  return error;
}

describe("withHubspotRetry", () => {
  it("retries on 429 until the call eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw axiosError(429);
      return "ok";
    });

    const result = await withHubspotRetry(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("aborts immediately on a 400, with no retries", async () => {
    const fn = vi.fn(async () => {
      throw axiosError(400);
    });

    await expect(withHubspotRetry(fn)).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting the retry budget on repeated 500s", async () => {
    const fn = vi.fn(async () => {
      throw axiosError(500);
    });

    await expect(withHubspotRetry(fn)).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(5); // 1 initial attempt + 4 retries
  }, 30_000);
});

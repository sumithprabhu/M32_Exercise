import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { getStoredTokens, isTokenExpired } from "../auth/token.store.js";
import { refreshAccessToken } from "../auth/oauth.service.js";

const HUBSPOT_API_BASE_URL = "https://api.hubapi.com";

declare module "axios" {
  interface InternalAxiosRequestConfig {
    _retriedAfterRefresh?: boolean;
  }
}

async function ensureFreshAccessToken(): Promise<string> {
  const tokens = getStoredTokens();
  if (!tokens) {
    throw new Error("No HubSpot tokens found. Complete the OAuth flow via /auth/install first");
  }
  if (isTokenExpired(tokens)) {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

export function createHubspotClient(): AxiosInstance {
  const client = axios.create({ baseURL: HUBSPOT_API_BASE_URL });

  client.interceptors.request.use(async (requestConfig) => {
    const accessToken = await ensureFreshAccessToken();
    requestConfig.headers.set("Authorization", `Bearer ${accessToken}`);
    return requestConfig;
  });

  // Belt-and-suspenders: the request interceptor refreshes proactively on expiry,
  // but a 401 can still slip through (clock skew, token revoked mid-flight). This
  // catches that case and retries the original request exactly once.
  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!axios.isAxiosError(error)) throw error;
      const originalRequest = error.config as InternalAxiosRequestConfig | undefined;
      if (error.response?.status !== 401 || !originalRequest || originalRequest._retriedAfterRefresh) {
        throw error;
      }
      const tokens = getStoredTokens();
      if (!tokens) throw error;

      originalRequest._retriedAfterRefresh = true;
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      originalRequest.headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
      return client(originalRequest);
    }
  );

  return client;
}

export const hubspotClient = createHubspotClient();

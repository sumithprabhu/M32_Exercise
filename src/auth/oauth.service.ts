import axios from "axios";
import { config } from "../config/env.js";
import { saveTokens, type StoredTokens } from "./token.store.js";

const HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

const CONTACTS_SCOPES = ["crm.objects.contacts.read", "crm.objects.contacts.write"];

interface HubspotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function tokenResponseToStoredTokens(data: HubspotTokenResponse): StoredTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export function buildAuthorizationUrl(): string {
  const url = new URL(HUBSPOT_AUTH_URL);
  url.searchParams.set("client_id", config.HUBSPOT_CLIENT_ID);
  url.searchParams.set("redirect_uri", config.HUBSPOT_REDIRECT_URI);
  url.searchParams.set("scope", CONTACTS_SCOPES.join(" "));
  return url.toString();
}

export async function exchangeCodeForTokens(code: string): Promise<StoredTokens> {
  const response = await axios.post<HubspotTokenResponse>(
    HUBSPOT_TOKEN_URL,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.HUBSPOT_CLIENT_ID,
      client_secret: config.HUBSPOT_CLIENT_SECRET,
      redirect_uri: config.HUBSPOT_REDIRECT_URI,
      code,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const tokens = tokenResponseToStoredTokens(response.data);
  saveTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(refreshToken: string): Promise<StoredTokens> {
  const response = await axios.post<HubspotTokenResponse>(
    HUBSPOT_TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.HUBSPOT_CLIENT_ID,
      client_secret: config.HUBSPOT_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const tokens = tokenResponseToStoredTokens(response.data);
  saveTokens(tokens);
  return tokens;
}

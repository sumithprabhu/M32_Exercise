import { db } from "../db/db.js";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface OAuthTokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function getStoredTokens(): StoredTokens | null {
  const row = db
    .prepare("SELECT access_token, refresh_token, expires_at FROM oauth_tokens WHERE id = 1")
    .get() as OAuthTokenRow | undefined;
  if (!row) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
  };
}

export function saveTokens(tokens: StoredTokens): void {
  db.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, expires_at)
     VALUES (1, @accessToken, @refreshToken, @expiresAt)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at`
  ).run(tokens);
}

// 60s buffer to avoid racing the exact expiry instant against HubSpot's clock.
export function isTokenExpired(tokens: StoredTokens): boolean {
  return Date.now() >= tokens.expiresAt - 60_000;
}

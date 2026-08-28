import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  HUBSPOT_CLIENT_ID: z.string().min(1, "HUBSPOT_CLIENT_ID is required"),
  HUBSPOT_CLIENT_SECRET: z.string().min(1, "HUBSPOT_CLIENT_SECRET is required"),
  HUBSPOT_REDIRECT_URI: z.string().url(),
  HUBSPOT_WEBHOOK_SECRET: z.string().min(1, "HUBSPOT_WEBHOOK_SECRET is required"),
  DATABASE_PATH: z.string().min(1).default("./data/app.db"),
  PORT: z.coerce.number().int().positive().default(3000),
  // 0 disables the background scheduler; POST /sync/contacts still works either way.
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().nonnegative().default(0),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();
export type AppConfig = typeof config;

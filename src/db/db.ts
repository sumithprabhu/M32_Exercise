import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { config } from "../config/env.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

function openDatabase(): Database.Database {
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
  const db = new Database(config.DATABASE_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(join(currentDir, "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}

export const db = openDatabase();

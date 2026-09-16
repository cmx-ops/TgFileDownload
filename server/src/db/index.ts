import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations/run.js";

const DATA_DIR = process.env.DATA_DIR || "./data";
const DB_PATH = process.env.DB_PATH || `${DATA_DIR}/app.db`;

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  // Ensure data directory exists
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read/write performance
  db.exec("PRAGMA journal_mode=WAL");
  // Enable foreign keys
  db.exec("PRAGMA foreign_keys=ON");

  // Run migrations
  runMigrations(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
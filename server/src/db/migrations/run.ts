import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runMigrations(db: Database): void {
  // Create the metadata table that tracks applied migrations
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version    INTEGER PRIMARY KEY,
    name      TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Read all .sql files from the migrations directory
  const files = readdirSync(__dirname)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[migrations] no migration files found");
    return;
  }

  // Get already-applied migrations
  const appliedRows = db
    .query("SELECT name FROM _migrations")
    .all() as { name: string }[];
  const applied = new Set(appliedRows.map((r) => r.name));

  // Apply each un-applied migration in a transaction
  for (const file of files) {
    if (applied.has(file)) continue;

    const version = parseInt(file.split("_")[0], 10);
    if (Number.isNaN(version)) {
      throw new Error(`[migrations] invalid migration filename: ${file} — expected NN_*.sql`);
    }

    const sql = readFileSync(join(__dirname, file), "utf-8");

    db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO _migrations (version, name) VALUES (?, ?)").run(version, file);
    })();

    console.log(`[migrations] applied ${file}`);
  }
}
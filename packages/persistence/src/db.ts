import { createRequire } from "node:module";
import { SCHEMA_SQL } from "./schema.sql.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
  };
};

export type Database = InstanceType<typeof DatabaseSync>;

export function openDatabase(filePath: string): Database {
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_SQL);
  migrateOpsQueue(db);
  db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)").run("schema_version", "2");
  return db;
}

function migrateOpsQueue(db: Database) {
  const cols = db.prepare("PRAGMA table_info(ops_queue)").all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === "base_version")) {
    db.exec("ALTER TABLE ops_queue ADD COLUMN base_version INTEGER");
  }
}

export function closeDatabase(db: Database) {
  db.close();
}

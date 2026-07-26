import { DatabaseSync } from "node:sqlite";
import type { SaveStorage } from "./storage";

const SAVE_SLOT = 1;

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS saves (slot INTEGER PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  return db;
}

export function writeSlot(dbPath: string, json: string): void {
  const db = openDb(dbPath);
  try {
    db.prepare(
      `INSERT INTO saves (slot, state_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(slot) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
    ).run(SAVE_SLOT, json, new Date().toISOString());
  } finally {
    db.close();
  }
}

export function readSlot(dbPath: string): string | undefined {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare("SELECT state_json FROM saves WHERE slot = ?")
      .get(SAVE_SLOT) as { state_json: string } | undefined;
    return row?.state_json;
  } finally {
    db.close();
  }
}

export function clearSlot(dbPath: string): void {
  const db = openDb(dbPath);
  try {
    db.prepare("DELETE FROM saves WHERE slot = ?").run(SAVE_SLOT);
  } finally {
    db.close();
  }
}

export class SqliteSaveStorage implements SaveStorage {
  constructor(private readonly dbPath: string) {}

  load(): Promise<string | undefined> {
    return Promise.resolve(readSlot(this.dbPath));
  }

  save(json: string): Promise<void> {
    writeSlot(this.dbPath, json);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    clearSlot(this.dbPath);
    return Promise.resolve();
  }
}

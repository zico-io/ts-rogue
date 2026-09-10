import { DatabaseSync } from "node:sqlite";

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

import { DatabaseSync } from "node:sqlite";
import type { SaveStorage } from "./storage";

/** Single save slot, per PROJECT_PLAN §8 (simplified: whole-state JSON blob). */
const SAVE_SLOT = 1;

/**
 * `node:sqlite` is a synchronous API (no separate worker thread), so this
 * module exposes both a synchronous helper set - kept for `save.ts`'s
 * long-standing sync API, which existing callers (`app.tsx`,
 * `ChurchView.tsx`, and every test in `save.test.ts`) rely on staying
 * sync - and `SqliteSaveStorage`, an async `SaveStorage` implementation
 * (ROG-46) that wraps the same helpers in resolved promises so the terminal
 * backend is swappable with the browser's `IndexedDbSaveStorage` wherever
 * code is written against the shared interface instead of these concrete
 * functions.
 */

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS saves (slot INTEGER PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  return db;
}

/** Write `json` to the single save slot, upserting over any prior save. */
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

/** Read the single save slot's JSON blob, or `undefined` if it is empty. */
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

/** Delete the single save slot, if present. */
export function clearSlot(dbPath: string): void {
  const db = openDb(dbPath);
  try {
    db.prepare("DELETE FROM saves WHERE slot = ?").run(SAVE_SLOT);
  } finally {
    db.close();
  }
}

/**
 * Async `SaveStorage` over `node:sqlite` (ROG-46). Terminal callers that
 * only need the sync API should keep using `save.ts`'s `saveGame`/
 * `loadGame`/`clearSave` directly - this class exists so the terminal
 * backend is usable anywhere code is written against the shared
 * `SaveStorage` interface, matching the browser's `IndexedDbSaveStorage`.
 */
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

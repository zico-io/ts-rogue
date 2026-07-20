import { DatabaseSync } from "node:sqlite";
import type { GameState } from "../engine/state/types.js";

/**
 * Whole-state JSON serialization (PROJECT_PLAN §8). This is the save format
 * the sqlite-backed store below round-trips through.
 */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  return JSON.parse(json) as GameState;
}

/** Default sqlite file for the single save slot. */
export const DEFAULT_SAVE_PATH = "./save.db";

/** Single save slot, per PROJECT_PLAN §8 (simplified: whole-state JSON blob). */
const SAVE_SLOT = 1;

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS saves (slot INTEGER PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  return db;
}

/** Write `state` to the single save slot, upserting over any prior save. */
export function saveGame(
  state: GameState,
  dbPath: string = DEFAULT_SAVE_PATH,
): void {
  const db = openDb(dbPath);
  try {
    db.prepare(
      `INSERT INTO saves (slot, state_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(slot) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
    ).run(SAVE_SLOT, serialize(state), new Date().toISOString());
  } finally {
    db.close();
  }
}

/** Load the single save slot, or `undefined` on a fresh boot with no save yet. */
export function loadGame(
  dbPath: string = DEFAULT_SAVE_PATH,
): GameState | undefined {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare("SELECT state_json FROM saves WHERE slot = ?")
      .get(SAVE_SLOT) as { state_json: string } | undefined;
    return row ? deserialize(row.state_json) : undefined;
  } finally {
    db.close();
  }
}

import { DatabaseSync } from "node:sqlite";
import { DEFAULT_CLASS_ID } from "../data/classes";
import type { GameState, LogEntry } from "../engine/state/types";

/**
 * Whole-state JSON serialization (PROJECT_PLAN §8). This is the save format
 * the sqlite-backed store below round-trips through.
 */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Parse a serialized `GameState` JSON blob. Adds forward-compatible defaults
 * for fields introduced after the initial release so an older save does not
 * crash the engine: `flags` (Phase 6, ROG-12), `dungeonState.cleared`
 * (Phase 6, ROG-12), each party member's `classId` (ROG-17, defaulted to
 * the warrior class), the tavern `recruits` pool (ROG-21, empty on old saves),
 * and plain-string log lines (pre-ROG-31, upgraded to
 * `LogEntry` with the neutral kind) are filled in when absent. Everything is
 * plain data so no non-serializable values are introduced.
 */
export function deserialize(json: string): GameState {
  const state = JSON.parse(json) as GameState;
  state.log = (state.log as readonly (string | LogEntry)[]).map((line) =>
    typeof line === "string" ? { text: line, kind: "system" } : line,
  );
  if (!state.flags) {
    state.flags = { permadeath: false, gameOver: false };
  }
  if (state.dungeonState && state.dungeonState.cleared === undefined) {
    state.dungeonState.cleared = false;
  }
  for (const member of state.party) {
    if (!member.classId) member.classId = DEFAULT_CLASS_ID;
  }
  if (!state.recruits) state.recruits = [];
  return state;
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

/**
 * Clear the single save slot (Phase 6, ROG-12). Called by the UI when a
 * permadeath run ends so the next boot starts a fresh run instead of loading
 * the dead game-over state. I/O lives here in the persistence layer, not the
 * engine; the engine only sets the `gameOver` flag.
 */
export function clearSave(dbPath: string = DEFAULT_SAVE_PATH): void {
  const db = openDb(dbPath);
  try {
    db.prepare("DELETE FROM saves WHERE slot = ?").run(SAVE_SLOT);
  } finally {
    db.close();
  }
}

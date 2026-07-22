import { DEFAULT_CLASS_ID } from "../data/classes";
import type { GameState, LogEntry } from "../engine/state/types";

/**
 * Whole-state JSON serialization (PROJECT_PLAN §8). This is the portable
 * save format both storage backends (`sqliteStorage.ts` for the terminal,
 * `indexedDbStorage.ts` for the browser, ROG-46) round-trip through - only
 * the store is platform-specific, the format itself is not.
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

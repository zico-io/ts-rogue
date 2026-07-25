import { DEFAULT_CLASS_ID } from "../data/classes";
import { DEFAULT_LOOT_FILTER } from "../engine/loot/lootFilter";
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
 * `activatedWaypoints` (ENG-1, defaulted to just the village so an old save
 * still has a usable fast-travel picker), plain-string log lines (pre-ROG-31,
 * upgraded to `LogEntry` with the neutral kind), and `stash`/`lootFilter`/
 * `pendingLootTriage` (ENG-2, defaulted to empty/disabled/null so an old save
 * starts with a clean field backpack cap and no dangling triage) are filled
 * in when absent. Everything is plain data so no non-serializable values are
 * introduced.
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
  if (!state.activatedWaypoints) state.activatedWaypoints = ["village"];
  if (!state.stash) state.stash = [];
  if (!state.lootFilter) state.lootFilter = DEFAULT_LOOT_FILTER;
  if (state.pendingLootTriage === undefined) state.pendingLootTriage = null;
  return state;
}

import type { GameState } from "../engine/state/types.js";

/**
 * Whole-state JSON serialization (PROJECT_PLAN §8). The DB layer (Node's
 * node:sqlite) that stores these blobs lands in Phase 1; for now this is the
 * save format the rest of the game round-trips through.
 */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  return JSON.parse(json) as GameState;
}

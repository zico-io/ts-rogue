import type { InventoryItem, PartyMember } from "../entities/party.js";
import type { RngState } from "../rng/rng.js";
import type { WorldState } from "../world/types.js";

/** The scene the router is currently showing. */
export type Scene = "village" | "overworld" | "dungeon" | "battle";

/**
 * The single serializable state tree. Only the fields the current milestone
 * needs exist today; dungeon/battle are added as their PROJECT_PLAN phases
 * land.
 */
export interface GameState {
  seed: number;
  rngState: RngState;
  scene: Scene;
  log: readonly string[];
  party: PartyMember[];
  gold: number;
  inventory: InventoryItem[];
  worldState: WorldState;
}

/** A single-tile movement delta on the overworld grid. */
export type MoveDelta = -1 | 0 | 1;

/** Events the pure reducer understands. Seeded minimally to lock its signature. */
export type GameEvent =
  | { type: "NewGame"; seed: number }
  | { type: "ChangeScene"; scene: Scene }
  | { type: "Log"; message: string }
  | { type: "InnHeal" }
  | { type: "StoreBuy"; itemId: string; quantity: number }
  | { type: "StoreSell"; itemId: string; quantity: number }
  | { type: "MoveOverworld"; dx: MoveDelta; dy: MoveDelta };

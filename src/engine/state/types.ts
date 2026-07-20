import type { InventoryItem, PartyMember } from "../entities/party";
import type { RngState } from "../rng/rng";

/** The scene the router is currently showing. */
export type Scene = "village" | "overworld" | "dungeon" | "battle";

/**
 * The single serializable state tree. Only the fields the current milestone
 * needs exist today; world/dungeon/battle are added as their PROJECT_PLAN
 * phases land.
 */
export interface GameState {
  seed: number;
  rngState: RngState;
  scene: Scene;
  log: readonly string[];
  party: PartyMember[];
  gold: number;
  inventory: InventoryItem[];
}

/** Events the pure reducer understands. Seeded minimally to lock its signature. */
export type GameEvent =
  | { type: "NewGame"; seed: number }
  | { type: "ChangeScene"; scene: Scene }
  | { type: "Log"; message: string }
  | { type: "InnHeal" }
  | { type: "StoreBuy"; itemId: string; quantity: number }
  | { type: "StoreSell"; itemId: string; quantity: number };

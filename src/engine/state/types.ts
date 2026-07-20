import type { RngState } from "../rng/rng.js";

/** The scene the router is currently showing. */
export type Scene = "village" | "overworld" | "dungeon" | "battle";

/**
 * The single serializable state tree. Only the fields the current milestone
 * needs exist today; party/gold/inventory/world/dungeon/battle are added as
 * their PROJECT_PLAN phases land.
 */
export interface GameState {
  seed: number;
  rngState: RngState;
  scene: Scene;
  log: readonly string[];
}

/** Events the pure reducer understands. Seeded minimally to lock its signature. */
export type GameEvent =
  | { type: "NewGame"; seed: number }
  | { type: "ChangeScene"; scene: Scene }
  | { type: "Log"; message: string };

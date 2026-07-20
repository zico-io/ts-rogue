import type { BattleEvent, BattleState } from "../combat/types";
import type { InventoryItem, PartyMember } from "../entities/party";
import type { RngState } from "../rng/rng";
import type { DungeonState, WorldState } from "../world/types";

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
  /** `null` until the party enters a dungeon entrance on the overworld. */
  dungeonState: DungeonState | null;
  /** `null` outside battle; set by the encounter trigger points in the store. */
  battleState: BattleState | null;
}

/** A single-tile movement delta on the overworld grid. */
export type MoveDelta = -1 | 0 | 1;

/** Turn direction for first-person dungeon movement. */
export type TurnDirection = "left" | "right";

/** Step direction for first-person dungeon movement. */
export type StepDirection = "forward" | "back";

/**
 * Events the pure reducer understands. Dungeon events (PROJECT_PLAN Phase 3)
 * flag encounters and move the party; battle events (PROJECT_PLAN Phase 4)
 * resolve turn-based combat.
 */
export type GameEvent =
  | { type: "NewGame"; seed: number }
  | { type: "ChangeScene"; scene: Scene }
  | { type: "Log"; message: string }
  | { type: "InnHeal" }
  | { type: "StoreBuy"; itemId: string; quantity: number }
  | { type: "StoreSell"; itemId: string; quantity: number }
  | { type: "MoveOverworld"; dx: MoveDelta; dy: MoveDelta }
  | { type: "TurnDungeon"; direction: TurnDirection }
  | { type: "StepDungeon"; direction: StepDirection }
  | { type: "OpenChest" }
  | { type: "DescendStairs" }
  | BattleEvent;

import type { BattleEvent, BattleState } from "../combat/types";
import type { InventoryItem, PartyMember } from "../entities/party";
import type { EquipmentSlotName, ItemInstance } from "../loot/types";
import type { RngState } from "../rng/rng";
import type { DungeonState, WorldState } from "../world/types";

/** The scene the router is currently showing. */
export type Scene = "village" | "overworld" | "dungeon" | "battle";

/**
 * Run-level flags (Phase 6, ROG-12). `permadeath` is chosen at new-game time
 * and decides whether a defeat ends the run (true) or revives the party at the
 * village with a gold penalty (false, the default). `gameOver` is a terminal
 * flag set only by the death resolver when `permadeath` is true; the UI checks
 * it to show a game-over screen and start a fresh run. Both are plain booleans
 * so they round-trip through serialize/deserialize with the rest of the tree.
 */
export interface GameFlags {
  permadeath: boolean;
  gameOver: boolean;
}

/**
 * The single serializable state tree. Only the fields the current milestone
 * needs exist today; dungeon/battle are added as their PROJECT_PLAN phases
 * land. Phase 5 (ROG-11) adds `items` (generated, affix-bearing equipment in
 * the backpack) and `nextItemId` (the monotonically increasing source of unique
 * item instance ids, so loot ids are deterministic from the event history).
 * Phase 6 (ROG-12) adds `flags` (run-level permadeath and game-over flags).
 * ROG-17 adds `classId` on each `PartyMember` (the chosen character class).
 * ROG-20 makes `party` support up to 4 members that each act and get targeted
 * in battle.
 */
export interface GameState {
  seed: number;
  rngState: RngState;
  scene: Scene;
  log: readonly string[];
  party: PartyMember[];
  gold: number;
  /** Owned, unequipped stacks of consumable items (potions, antidotes). */
  inventory: InventoryItem[];
  /** Owned, unequipped generated equipment instances (affix-bearing loot). */
  items: ItemInstance[];
  /** Next unique item instance id; stamped onto rolled loot deterministically. */
  nextItemId: number;
  worldState: WorldState;
  /** `null` until the party enters a dungeon entrance on the overworld. */
  dungeonState: DungeonState | null;
  /** `null` outside battle; set by the encounter trigger points in the store. */
  battleState: BattleState | null;
  flags: GameFlags;
}

/** A single-tile movement delta on the overworld grid. */
export type MoveDelta = -1 | 0 | 1;

/** Turn direction for first-person dungeon movement. */
export type TurnDirection = "left" | "right";

/** Step direction for first-person dungeon movement. */
export type StepDirection = "forward" | "back";

/**
 * Events the pure reducer understands. Dungeon events (PROJECT_PLAN Phase 3)
 * flag encounters and move the party; battle events (Phase 4) resolve
 * turn-based combat; loot/equip/sell events (Phase 5, ROG-11) flow generated
 * equipment between the backpack, equipment slots, and the store. Phase 6
 * (ROG-12) adds `ExitDungeon` (leave the active dungeon for the overworld) and
 * a `permadeath` option on `NewGame`. ROG-17 adds a `classId` option on
 * `NewGame` (the chosen character class; defaults to warrior when omitted).
 * ROG-20 adds `memberId` on `EquipItem`/`UnequipItem` (which party member the
 * action targets) and `RecruitMember` (dev-console party growth ahead of the
 * ROG-21 tavern recruiting UI).
 */
export type GameEvent =
  | { type: "NewGame"; seed: number; permadeath?: boolean; classId?: string }
  | { type: "ChangeScene"; scene: Scene }
  | { type: "Log"; message: string }
  | { type: "InnHeal" }
  | { type: "StoreBuy"; itemId: string; quantity: number }
  | { type: "StoreSell"; itemId: string; quantity: number }
  | { type: "EquipItem"; instanceId: string; memberId: string }
  | { type: "UnequipItem"; slot: EquipmentSlotName; memberId: string }
  | { type: "SellItem"; instanceId: string }
  | { type: "RecruitMember"; classId: string }
  | { type: "MoveOverworld"; dx: MoveDelta; dy: MoveDelta }
  | { type: "TurnDungeon"; direction: TurnDirection }
  | { type: "StepDungeon"; direction: StepDirection }
  | { type: "OpenChest" }
  | { type: "DescendStairs" }
  | { type: "ExitDungeon" }
  | BattleEvent;

import type { BattleEvent, BattleState } from "../combat/types";
import type { InventoryItem, PartyMember } from "../entities/party";
import type { LootFilterRules } from "../loot/lootFilter";
import type { LootPickupOutcome, PendingLootTriage } from "../loot/pickup";
import type { EquipmentSlotName, ItemInstance } from "../loot/types";
import type { RngState } from "../rng/rng";
import type { DungeonState, WorldState } from "../world/types";

/** The scene the router is currently showing. */
export type Scene = "village" | "overworld" | "dungeon" | "battle";

/** Category of a log line; drives message-log coloring (ROG-31). */
export type LogKind = "damage" | "loot" | "quest" | "system";

/** One game-log line with its display category. */
export interface LogEntry {
  text: string;
  kind: LogKind;
}

/** Build a log entry; `kind` defaults to the neutral system category. */
export function entry(text: string, kind: LogKind = "system"): LogEntry {
  return { text, kind };
}

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
  log: readonly LogEntry[];
  party: PartyMember[];
  /** Tavern recruit pool (ROG-21); rerolls on inn rest, persisted so save/load doesn't reroll. */
  recruits: PartyMember[];
  gold: number;
  /** Owned, unequipped stacks of consumable items (potions, antidotes). */
  inventory: InventoryItem[];
  /** Owned, unequipped generated equipment instances (affix-bearing loot). */
  items: ItemInstance[];
  /** Next unique item instance id; stamped onto rolled loot deterministically. */
  nextItemId: number;
  /**
   * Ids from `world/waypoints.ts`'s registry (ENG-1 fast travel). Activates
   * on first visit, save/load-safe (a plain string array round-trips through
   * JSON with the rest of the tree), and resets to just the village waypoint
   * on a new run.
   */
  activatedWaypoints: readonly string[];
  worldState: WorldState;
  /** `null` until the party enters a dungeon entrance on the overworld. */
  dungeonState: DungeonState | null;
  /** `null` outside battle; set by the encounter trigger points in the store. */
  battleState: BattleState | null;
  flags: GameFlags;
  /**
   * Unlimited village storage for generated gear (ENG-5). Deposited items
   * leave `items` (the field backpack) entirely, so they never count
   * against `FIELD_BACKPACK_CAP` (`engine/loot/inventory.ts`).
   */
  stash: ItemInstance[];
  /**
   * Overflow gear drops awaiting a swap-or-dismantle decision (ENG-5),
   * queued when the field backpack was already full at pickup time.
   * `null` when nothing is pending. The UI treats a non-null queue as a
   * mandatory overlay (`LootTriageScreen`) that preempts normal play.
   */
  pendingLootTriage: PendingLootTriage | null;
  /**
   * Player-editable loot filter rules (ENG-17). Decides which items are
   * auto-dismantled on pickup. Whole-object replaced via `SetLootFilter`;
   * the future settings-pane issue (ENG-19) can refine to partial updates.
   */
  lootFilter: LootFilterRules;
  /**
   * Outcome of the most recent auto-dismantle filter pass (ENG-18). Set by
   * `OpenChest` and `finalizeWon` after the filter runs; `null` when no
   * pickup has occurred yet this run. Intended for the UI toast (ENG-20)
   * to display without re-deriving what happened.
   */
  lastLootOutcome: LootPickupOutcome | null;
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
 * ROG-21 tavern recruiting UI). ROG-21 adds the tavern events: `RefreshRecruits`
 * (roll the recruit pool), `HireRecruit` (pay to add a pool recruit to the
 * party), and `DismissMember` (remove a non-hero member). ENG-1 adds `Zoom`
 * (fast travel to a landmark the party has already activated this run);
 * it is blocked while inside a dungeon or battle - evac first. ENG-4 adds
 * `UseFieldItem` (consume a heal item on a chosen party member from the
 * inventory screen, outside battle - battle's own item command is unchanged).
 * ENG-5 adds the stash and full-backpack-triage events:
 * `DepositItem`/`WithdrawItem` move a generated item between the field
 * backpack and the unlimited village stash (withdraw refuses once the field
 * backpack is at `FIELD_BACKPACK_CAP`), and `ResolveLootTriage` resolves the
 * oldest queued overflow drop in `pendingLootTriage` by dismantling either
 * the named carried item (freeing a slot for the drop) or the drop itself.
 * ENG-17 adds `SetLootFilter` (whole-object replace for the loot filter
 * rules persisted on `GameState.lootFilter`).
 * ENG-18 adds last-loot-outcome tracking (no new event, just a state field
 * set by existing reducers).
 */
export type GameEvent =
  | {
      type: "NewGame";
      seed: number;
      permadeath?: boolean;
      classId?: string;
      name?: string;
    }
  | { type: "ChangeScene"; scene: Scene }
  | { type: "Log"; message: string; kind?: LogKind }
  | { type: "InnHeal" }
  | { type: "StoreBuy"; itemId: string; quantity: number }
  | { type: "StoreSell"; itemId: string; quantity: number }
  | { type: "EquipItem"; instanceId: string; memberId: string }
  | { type: "UnequipItem"; slot: EquipmentSlotName; memberId: string }
  | { type: "SellItem"; instanceId: string }
  | { type: "RecruitMember"; classId: string }
  | { type: "RefreshRecruits" }
  | { type: "HireRecruit"; index: number }
  | { type: "DismissMember"; memberId: string }
  | { type: "MoveOverworld"; dx: MoveDelta; dy: MoveDelta }
  | { type: "TurnDungeon"; direction: TurnDirection }
  | { type: "StepDungeon"; direction: StepDirection }
  | { type: "OpenChest" }
  | { type: "DescendStairs" }
  | { type: "ExitDungeon" }
  | { type: "Zoom"; waypointId: string }
  | { type: "UseFieldItem"; itemId: string; memberId: string }
  | { type: "DepositItem"; instanceId: string }
  | { type: "WithdrawItem"; instanceId: string }
  | {
      type: "ResolveLootTriage";
      action: "dismantleCarried";
      instanceId: string;
    }
  | { type: "ResolveLootTriage"; action: "dismantleDrop" }
  | { type: "SetLootFilter"; rules: LootFilterRules }
  | BattleEvent;

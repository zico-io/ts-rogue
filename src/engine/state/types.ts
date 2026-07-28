import type { BattleEvent, BattleState } from "../combat/types";
import type { InventoryItem, PartyMember } from "../entities/party";
import type { LogEntry, LogKind } from "../log";
import type { LootFilterRules } from "../loot/lootFilter";
import type { LootPickupOutcome, PendingLootTriage } from "../loot/pickup";
import type { EquipmentSlotName, ItemInstance } from "../loot/types";
import type { RngState } from "../rng/rng";
import type { DungeonState, WorldState } from "../world/types";

export type { LogEntry, LogEntryTags, LogKind } from "../log";
export { entry } from "../log";

export type Scene = "village" | "overworld" | "dungeon" | "battle";

export interface GameFlags {
  permadeath: boolean;
  gameOver: boolean;
}

export interface GameState {
  seed: number;
  rngState: RngState;
  scene: Scene;
  log: readonly LogEntry[];
  party: PartyMember[];

  recruits: PartyMember[];
  gold: number;

  // Rotating rare-gear section (ENG-41); restocks on the same cadence as
  // the tavern recruit pool (inn rest) so save/load never rerolls it.
  shopStock: ItemInstance[];

  inventory: InventoryItem[];

  items: ItemInstance[];

  nextItemId: number;

  activatedWaypoints: readonly string[];
  worldState: WorldState;

  dungeonState: DungeonState | null;

  // Persistent per-story-dungeon completion record, keyed by the def id
  // (dungeonDefFor(id).id) rather than the entrance's raw dungeonId, so it
  // survives the ROG-90 entrance remap. Distinct from DungeonState.cleared,
  // which is a per-session flag on the current run only.
  clearedAt: Readonly<Record<string, number>>;

  battleState: BattleState | null;
  flags: GameFlags;

  stash: ItemInstance[];

  pendingLootTriage: PendingLootTriage | null;

  lootFilter: LootFilterRules;

  lastLootOutcome: LootPickupOutcome | null;
}

export type MoveDelta = -1 | 0 | 1;

export type TurnDirection = "left" | "right";

export type StepDirection = "forward" | "back";

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
  | { type: "StoreBuyRolled"; instanceId: string }
  | { type: "RefreshShopStock" }
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

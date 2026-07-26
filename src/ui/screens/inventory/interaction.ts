import type { InventoryItem } from "../../../engine/entities/party";
import type { EquipmentSlotName } from "../../../engine/loot/equipment";
import { itemBaseSlot, itemSellPrice } from "../../../engine/loot/items";
import type { LootFilterRules } from "../../../engine/loot/lootFilter";
import {
  type ItemInstance,
  type ItemStat,
  RARITY_ORDER,
  type Rarity,
} from "../../../engine/loot/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";
import type { PackEntry } from "../village/interaction";

export type InventorySection =
  | "gear"
  | "consumables"
  | "currency"
  | "quest"
  | "filter";

const SECTIONS: readonly InventorySection[] = [
  "gear",
  "consumables",
  "currency",
  "quest",
  "filter",
];

export type SortKey = "rarity" | "ilvl" | "slot" | "value";

export const SORT_KEYS: readonly SortKey[] = [
  "rarity",
  "ilvl",
  "slot",
  "value",
];

export function sortPackEntries<T extends PackEntry>(
  entries: readonly T[],
  sortKey: SortKey,
): T[] {
  const equipped = entries.filter((entry) => entry.kind === "equipped");
  const backpack = entries.filter(
    (entry): entry is Extract<T, { kind: "backpack" }> =>
      entry.kind === "backpack",
  );
  const sorted = [...backpack].sort((a, b) =>
    compareBySortKey(a.item, b.item, sortKey),
  );
  return [...equipped, ...sorted];
}

function compareBySortKey(
  a: ItemInstance,
  b: ItemInstance,
  sortKey: SortKey,
): number {
  switch (sortKey) {
    case "rarity":
      return RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity];
    case "ilvl":
      return b.ilvl - a.ilvl;
    case "value":
      return itemSellPrice(b) - itemSellPrice(a);
    case "slot":
      return (itemBaseSlot(a) ?? "").localeCompare(itemBaseSlot(b) ?? "");
    default:
      return 0;
  }
}

function cycleIndex(current: number, delta: -1 | 1, length: number): number {
  return (current + delta + length) % length;
}

function cycleValue<T>(values: readonly T[], current: T, delta: -1 | 1): T {
  const idx = values.indexOf(current);
  if (idx === -1) return values[0];
  return values[(idx + delta + values.length) % values.length];
}

export const FILTER_ROW_COUNT = 8;

const RARITY_VALUES: readonly (Rarity | undefined)[] = [
  undefined,
  "common",
  "magic",
  "rare",
  "unique",
];

const ILVL_OFFSET_VALUES: readonly (number | undefined)[] = [
  undefined,
  -5,
  -3,
  0,
  3,
  5,
  10,
];

export const ALL_STATS: readonly ItemStat[] = ["str", "agi", "vit", "int"];

const TIER_BY_ROW = [1, 2, 3] as const;

function tierForFilterRow(row: number): number | undefined {
  return TIER_BY_ROW[row];
}

function statForFilterRow(row: number): ItemStat | undefined {
  const index = row - 4;
  if (index >= 0 && index < ALL_STATS.length) return ALL_STATS[index];
  return undefined;
}

export function cycleFilterRow(
  current: LootFilterRules,
  cursor: number,
  delta: -1 | 1,
): LootFilterRules {
  const tier = tierForFilterRow(cursor);
  if (tier !== undefined) {
    const currentRarity = current.minRarityByTier[tier];
    const nextRarity = cycleValue(RARITY_VALUES, currentRarity, delta);
    const nextMap = { ...current.minRarityByTier };
    if (nextRarity === undefined) {
      delete nextMap[tier];
    } else {
      nextMap[tier] = nextRarity;
    }
    return { ...current, minRarityByTier: nextMap };
  }

  if (cursor === 3) {
    const nextOffset = cycleValue(
      ILVL_OFFSET_VALUES,
      current.minIlvlOffset,
      delta,
    );
    return { ...current, minIlvlOffset: nextOffset };
  }

  const stat = statForFilterRow(cursor);
  if (stat !== undefined) {
    const has = current.keepAffixStats.includes(stat);
    const nextStats = has
      ? current.keepAffixStats.filter((s) => s !== stat)
      : [...current.keepAffixStats, stat];
    return { ...current, keepAffixStats: nextStats };
  }

  return current;
}

export interface InventoryUiState {
  section: InventorySection;
  memberIndex: number;
  packCursor: number;
  sortKey: SortKey;

  inspecting: boolean;

  consumableCursor: number;

  filterCursor: number;
}

export const INITIAL_INVENTORY_UI_STATE: InventoryUiState = {
  section: "gear",
  memberIndex: 0,
  packCursor: 0,
  sortKey: "rarity",
  inspecting: false,
  consumableCursor: 0,
  filterCursor: 0,
};

export interface InventoryUiContext {
  partyLength: number;
  memberId: string;

  packEntries: readonly PackEntry[];

  consumables: readonly InventoryItem[];

  lootFilter: LootFilterRules;
}

export type InventoryUiEffect =
  | { type: "equip"; instanceId: string; memberId: string }
  | { type: "unequip"; slot: EquipmentSlotName; memberId: string }
  | { type: "useItem"; itemId: string; memberId: string }
  | { type: "back" }
  | { type: "setLootFilter"; rules: LootFilterRules };

export interface InventoryUiResult {
  state: InventoryUiState;
  effect?: InventoryUiEffect;
}

const inventoryCommonKeymap: Keymap = {
  escape: { kind: "cancel" },
  tab: { kind: "switchMode" },
};

const inventoryGearKeymap: Keymap = {
  ...inventoryCommonKeymap,
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
  enter: { kind: "confirm" },
  "char:e": { kind: "equip" },
  "char:u": { kind: "unequip" },
  "char:r": { kind: "cycleSort" },
};

const inventoryConsumablesKeymap: Keymap = {
  ...inventoryCommonKeymap,
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
  "char:u": { kind: "useItem" },
};

const inventoryFilterKeymap: Keymap = {
  ...inventoryCommonKeymap,
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
  enter: { kind: "confirm" },
};

export function resolveInventoryIntent(
  section: InventorySection,
  key: KeyName,
): Intent | undefined {
  if (section === "gear") return inventoryGearKeymap[key];
  if (section === "consumables") return inventoryConsumablesKeymap[key];
  if (section === "filter") return inventoryFilterKeymap[key];
  return inventoryCommonKeymap[key];
}

export function reduceInventoryUi(
  state: InventoryUiState,
  intent: Intent,
  ctx: InventoryUiContext,
): InventoryUiResult {
  if (intent.kind === "cancel") return { state, effect: { type: "back" } };
  if (intent.kind === "switchMode") {
    const nextIndex = (SECTIONS.indexOf(state.section) + 1) % SECTIONS.length;
    return {
      state: {
        ...state,
        section: SECTIONS[nextIndex],
        packCursor: 0,
        consumableCursor: 0,
        filterCursor: 0,
        inspecting: false,
      },
    };
  }

  if (
    (intent.kind === "menuLeft" || intent.kind === "menuRight") &&
    ctx.partyLength > 1 &&
    (state.section === "gear" || state.section === "consumables")
  ) {
    const delta = intent.kind === "menuLeft" ? -1 : 1;
    const next =
      (state.memberIndex + delta + ctx.partyLength) % ctx.partyLength;
    return {
      state: {
        ...state,
        memberIndex: next,
        packCursor: 0,
        consumableCursor: 0,
        inspecting: false,
      },
    };
  }

  if (state.section === "consumables") {
    if (intent.kind === "menuUp" && ctx.consumables.length > 0) {
      return {
        state: {
          ...state,
          consumableCursor: cycleIndex(
            state.consumableCursor,
            -1,
            ctx.consumables.length,
          ),
        },
      };
    }
    if (intent.kind === "menuDown" && ctx.consumables.length > 0) {
      return {
        state: {
          ...state,
          consumableCursor: cycleIndex(
            state.consumableCursor,
            1,
            ctx.consumables.length,
          ),
        },
      };
    }
    if (intent.kind === "useItem") {
      const index = Math.min(
        state.consumableCursor,
        ctx.consumables.length - 1,
      );
      const selected = ctx.consumables[index];
      if (!selected) return { state };
      return {
        state,
        effect: {
          type: "useItem",
          itemId: selected.itemId,
          memberId: ctx.memberId,
        },
      };
    }
    return { state };
  }

  if (state.section === "filter") {
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          filterCursor: cycleIndex(state.filterCursor, -1, FILTER_ROW_COUNT),
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: {
          ...state,
          filterCursor: cycleIndex(state.filterCursor, 1, FILTER_ROW_COUNT),
        },
      };
    }
    if (
      intent.kind === "confirm" ||
      intent.kind === "menuLeft" ||
      intent.kind === "menuRight"
    ) {
      const delta = intent.kind === "menuLeft" ? -1 : 1;
      const rules = cycleFilterRow(ctx.lootFilter, state.filterCursor, delta);
      return {
        state,
        effect: { type: "setLootFilter", rules },
      };
    }
    return { state };
  }

  if (state.section !== "gear") return { state };

  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        packCursor: cycleIndex(state.packCursor, -1, ctx.packEntries.length),
        inspecting: false,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: {
        ...state,
        packCursor: cycleIndex(state.packCursor, 1, ctx.packEntries.length),
        inspecting: false,
      },
    };
  }
  if (intent.kind === "cycleSort") {
    const nextIndex = (SORT_KEYS.indexOf(state.sortKey) + 1) % SORT_KEYS.length;
    return {
      state: {
        ...state,
        sortKey: SORT_KEYS[nextIndex],
        packCursor: 0,
        inspecting: false,
      },
    };
  }
  if (intent.kind === "confirm") {
    return { state: { ...state, inspecting: !state.inspecting } };
  }

  const packIndex = Math.min(state.packCursor, ctx.packEntries.length - 1);
  const selected = ctx.packEntries[packIndex];
  if (!selected) return { state };
  if (selected.kind === "backpack" && intent.kind === "equip") {
    return {
      state,
      effect: {
        type: "equip",
        instanceId: selected.item.instanceId,
        memberId: ctx.memberId,
      },
    };
  }
  if (selected.kind === "equipped" && intent.kind === "unequip") {
    return {
      state,
      effect: {
        type: "unequip",
        slot: selected.slot,
        memberId: ctx.memberId,
      },
    };
  }
  return { state };
}

/**
 * Inventory screen input handling (ENG-2), following `village/interaction.ts`'s
 * split: this module owns the pure mode/cursor state machine, the Ink
 * component (`InventoryScreen.tsx`) only normalizes input, resolves an
 * intent, applies the result, and dispatches the mapped event.
 *
 * Four panes, cycled with Tab: `gear` (reuses `village/interaction.ts`'s
 * `buildPackEntries`/`EQUIP_SLOTS` for equip/unequip and adds sort + a
 * full-affix inspect view), `consumables` (use a heal item on a party member
 * outside battle), `currency` (gold, read-only), and `filter` (the loot
 * filter's settings pane).
 */

import type { InventoryItem } from "../../../engine/entities/party";
import type { EquipmentSlotName } from "../../../engine/loot/equipment";
import { itemBaseSlot, itemSellPrice } from "../../../engine/loot/items";
import type { LootFilterSettings } from "../../../engine/loot/lootFilter";
import type {
  ItemInstance,
  ItemStat,
  Rarity,
} from "../../../engine/loot/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";
import type { PackEntry } from "../village/interaction";

export type InventoryMode = "gear" | "consumables" | "currency" | "filter";
export type GearSort = "rarity" | "ilvl" | "slot" | "value";

const MODES: readonly InventoryMode[] = [
  "gear",
  "consumables",
  "currency",
  "filter",
];
const SORTS: readonly GearSort[] = ["rarity", "ilvl", "slot", "value"];
const RARITY_ORDER: readonly Rarity[] = ["common", "magic", "rare", "unique"];
/** Filter pane rows: enabled, minRarity, minIlvlOffset, then one row per keep-affix stat. */
const KEEP_STAT_ROWS: readonly ItemStat[] = ["str", "agi", "vit", "int"];
const FILTER_ROW_COUNT = 3 + KEEP_STAT_ROWS.length;

const GEAR_RARITY_RANK: Record<Rarity, number> = {
  common: 0,
  magic: 1,
  rare: 2,
  unique: 3,
};

/** Sorts a backpack list for the gear pane; ties keep their original (drop) order. */
export function sortBackpackItems(
  items: readonly ItemInstance[],
  sort: GearSort,
): ItemInstance[] {
  const copy = [...items];
  switch (sort) {
    case "rarity":
      copy.sort(
        (a, b) => GEAR_RARITY_RANK[b.rarity] - GEAR_RARITY_RANK[a.rarity],
      );
      break;
    case "ilvl":
      copy.sort((a, b) => b.ilvl - a.ilvl);
      break;
    case "slot":
      copy.sort((a, b) =>
        (itemBaseSlot(a) ?? "").localeCompare(itemBaseSlot(b) ?? ""),
      );
      break;
    case "value":
      copy.sort((a, b) => itemSellPrice(b) - itemSellPrice(a));
      break;
  }
  return copy;
}

export interface InventoryUiState {
  mode: InventoryMode;
  memberIndex: number;
  gearCursor: number;
  gearSort: GearSort;
  /** Whether the selected gear entry's full-affix detail view is open. */
  inspecting: boolean;
  consumableCursor: number;
  filterCursor: number;
}

export const INITIAL_INVENTORY_UI_STATE: InventoryUiState = {
  mode: "gear",
  memberIndex: 0,
  gearCursor: 0,
  gearSort: "rarity",
  inspecting: false,
  consumableCursor: 0,
  filterCursor: 0,
};

export interface InventoryUiContext {
  partyLength: number;
  memberId: string;
  /** `buildPackEntries(member, sortedItems)` - equip slots first, then the sorted backpack. */
  packEntries: readonly PackEntry[];
  consumables: readonly InventoryItem[];
  lootFilter: LootFilterSettings;
}

export type InventoryUiEffect =
  | { type: "close" }
  | { type: "equip"; instanceId: string; memberId: string }
  | { type: "unequip"; slot: EquipmentSlotName; memberId: string }
  | { type: "useFieldItem"; itemId: string; memberId: string }
  | { type: "setLootFilter"; filter: LootFilterSettings };

export interface InventoryUiResult {
  state: InventoryUiState;
  effect?: InventoryUiEffect;
}

const commonKeymap: Keymap = {
  escape: { kind: "cancel" },
  tab: { kind: "switchMode" },
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
};

const gearKeymap: Keymap = {
  ...commonKeymap,
  enter: { kind: "inspect" },
  "char:i": { kind: "inspect" },
  "char:e": { kind: "equip" },
  "char:u": { kind: "unequip" },
  "char:r": { kind: "cycleSort" },
};

const consumablesKeymap: Keymap = {
  ...commonKeymap,
  "char:u": { kind: "useItem" },
};

const filterKeymap: Keymap = {
  ...commonKeymap,
  enter: { kind: "confirm" },
};

/** Resolves the `Intent` for a key press, given the Inventory screen's current pane. */
export function resolveInventoryIntent(
  mode: InventoryMode,
  key: KeyName,
): Intent | undefined {
  switch (mode) {
    case "gear":
      return gearKeymap[key];
    case "consumables":
      return consumablesKeymap[key];
    case "filter":
      return filterKeymap[key];
    case "currency":
      return commonKeymap[key];
  }
}

function cycleRarity(rarity: Rarity, dir: 1 | -1): Rarity {
  const index = RARITY_ORDER.indexOf(rarity);
  return RARITY_ORDER[
    (index + dir + RARITY_ORDER.length) % RARITY_ORDER.length
  ];
}

function toggleStat(stats: readonly ItemStat[], stat: ItemStat): ItemStat[] {
  return stats.includes(stat)
    ? stats.filter((s) => s !== stat)
    : [...stats, stat];
}

/**
 * Applies one edit to the filter pane's row under the cursor. `dir` only
 * matters for the two ordered rows (rarity, ilvl offset); the boolean rows
 * (enabled, each keep-affix stat) toggle regardless of direction, so Enter,
 * Left, and Right all act as "activate this row".
 */
export function applyFilterEdit(
  filter: LootFilterSettings,
  row: number,
  dir: 1 | -1,
): LootFilterSettings {
  if (row === 0) return { ...filter, enabled: !filter.enabled };
  if (row === 1)
    return { ...filter, minRarity: cycleRarity(filter.minRarity, dir) };
  if (row === 2)
    return { ...filter, minIlvlOffset: filter.minIlvlOffset + dir };
  const stat = KEEP_STAT_ROWS[row - 3];
  return stat
    ? { ...filter, keepAffixStats: toggleStat(filter.keepAffixStats, stat) }
    : filter;
}

/** Label for the filter pane's row under the cursor, for the hint/detail line. */
export function filterRowLabel(row: number): string {
  if (row === 0) return "Enabled";
  if (row === 1) return "Min rarity to keep";
  if (row === 2) return "Min ilvl offset";
  return `Always keep ${KEEP_STAT_ROWS[row - 3]?.toUpperCase()} affixes`;
}

export const FILTER_ROWS = FILTER_ROW_COUNT;

function reduceGear(
  state: InventoryUiState,
  intent: Intent,
  ctx: InventoryUiContext,
): InventoryUiResult {
  const len = ctx.packEntries.length;
  if (len === 0) return { state };
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        gearCursor: (state.gearCursor + len - 1) % len,
        inspecting: false,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: {
        ...state,
        gearCursor: (state.gearCursor + 1) % len,
        inspecting: false,
      },
    };
  }
  if (intent.kind === "cycleSort") {
    const next = SORTS[(SORTS.indexOf(state.gearSort) + 1) % SORTS.length];
    return {
      state: { ...state, gearSort: next, gearCursor: 0, inspecting: false },
    };
  }
  const index = Math.min(state.gearCursor, len - 1);
  const selected: PackEntry | undefined = ctx.packEntries[index];
  if (!selected) return { state };
  if (intent.kind === "inspect") {
    return { state: { ...state, inspecting: !state.inspecting } };
  }
  if (selected.kind === "backpack") {
    if (intent.kind === "equip") {
      return {
        state,
        effect: {
          type: "equip",
          instanceId: selected.item.instanceId,
          memberId: ctx.memberId,
        },
      };
    }
    return { state };
  }
  if (intent.kind === "unequip" && selected.item) {
    return {
      state,
      effect: { type: "unequip", slot: selected.slot, memberId: ctx.memberId },
    };
  }
  return { state };
}

function reduceConsumables(
  state: InventoryUiState,
  intent: Intent,
  ctx: InventoryUiContext,
): InventoryUiResult {
  const len = ctx.consumables.length;
  if (len === 0) return { state };
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        consumableCursor: (state.consumableCursor + len - 1) % len,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: { ...state, consumableCursor: (state.consumableCursor + 1) % len },
    };
  }
  if (intent.kind === "useItem") {
    const index = Math.min(state.consumableCursor, len - 1);
    const selected = ctx.consumables[index];
    if (!selected) return { state };
    return {
      state,
      effect: {
        type: "useFieldItem",
        itemId: selected.itemId,
        memberId: ctx.memberId,
      },
    };
  }
  return { state };
}

function reduceFilter(
  state: InventoryUiState,
  intent: Intent,
  ctx: InventoryUiContext,
): InventoryUiResult {
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        filterCursor:
          (state.filterCursor + FILTER_ROW_COUNT - 1) % FILTER_ROW_COUNT,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: {
        ...state,
        filterCursor: (state.filterCursor + 1) % FILTER_ROW_COUNT,
      },
    };
  }
  if (intent.kind === "confirm") {
    return {
      state,
      effect: {
        type: "setLootFilter",
        filter: applyFilterEdit(ctx.lootFilter, state.filterCursor, 1),
      },
    };
  }
  if (intent.kind === "menuLeft") {
    return {
      state,
      effect: {
        type: "setLootFilter",
        filter: applyFilterEdit(ctx.lootFilter, state.filterCursor, -1),
      },
    };
  }
  if (intent.kind === "menuRight") {
    return {
      state,
      effect: {
        type: "setLootFilter",
        filter: applyFilterEdit(ctx.lootFilter, state.filterCursor, 1),
      },
    };
  }
  return { state };
}

/** Pure transition function for the Inventory screen's four panes. */
export function reduceInventoryUi(
  state: InventoryUiState,
  intent: Intent,
  ctx: InventoryUiContext,
): InventoryUiResult {
  if (intent.kind === "cancel") {
    if (state.inspecting) return { state: { ...state, inspecting: false } };
    return { state, effect: { type: "close" } };
  }
  if (intent.kind === "switchMode") {
    const next = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length];
    return { state: { ...state, mode: next, inspecting: false } };
  }
  if (
    (intent.kind === "menuLeft" || intent.kind === "menuRight") &&
    ctx.partyLength > 1 &&
    (state.mode === "gear" || state.mode === "consumables")
  ) {
    const delta = intent.kind === "menuLeft" ? -1 : 1;
    const next =
      (state.memberIndex + delta + ctx.partyLength) % ctx.partyLength;
    return {
      state: {
        ...state,
        memberIndex: next,
        gearCursor: 0,
        consumableCursor: 0,
        inspecting: false,
      },
    };
  }

  switch (state.mode) {
    case "gear":
      return reduceGear(state, intent, ctx);
    case "consumables":
      return reduceConsumables(state, intent, ctx);
    case "filter":
      return reduceFilter(state, intent, ctx);
    case "currency":
      return { state };
  }
}

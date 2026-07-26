/**
 * Inventory screen input handling (ENG-3, workstream 1 of the ENG-2
 * inventory-system epic; ENG-4 adds field consumable use). This is the
 * dedicated gear/consumables/currency/quest browser that replaces
 * `StoreView`'s `pack` mode as the canonical place to inspect and equip
 * gear; the Store's backpack mode now only sells.
 *
 * Gear section reuses `village/interaction.ts`'s `buildPackEntries`/
 * `EQUIP_SLOTS`/`PackEntry` and `engine/loot/equipment.ts`'s `compareItem`/
 * `equipTargetSlot` rather than duplicating pack-row/compare logic - this
 * module only adds what's new: section cycling, backpack sorting, the
 * inspect toggle, and (ENG-4) the consumables section's item-use flow.
 * Currency is a read-only browse over `GameState.gold`; quest has no
 * backing data model yet (a future workstream), so it renders as an
 * explicit empty state. The consumables section shares the gear section's
 * `memberIndex` (the party-member switcher) as its heal target, so
 * Left/Right picks who a potion goes to no matter which section is open.
 *
 * ENG-19 adds the loot filter settings pane: a cursor-driven editor that
 * reads `GameState.lootFilter` from context and dispatches `SetLootFilter`
 * on every value change (Enter/Left/Right cycles the selected row's value).
 */

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

/** Backpack sort keys, cycled by `cycleSort` (Tab-adjacent, see keymap below). */
export type SortKey = "rarity" | "ilvl" | "slot" | "value";

export const SORT_KEYS: readonly SortKey[] = [
  "rarity",
  "ilvl",
  "slot",
  "value",
];

/**
 * Sorts a pack panel's backpack (non-equipped) rows by `sortKey`, leaving the
 * 4 equipped-slot rows pinned at the top in their original order, matching
 * the Store's pack panel layout. Rarity/ilvl/value sort highest-first (the
 * item you'd most want to look at first); slot sorts alphabetically. Pure -
 * ties keep their relative order (`Array#sort` is stable).
 */
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

/** Wraps `current + delta` into `[0, length)`. Shared modulo-cursor math for the gear section's `packCursor` and the consumables section's `consumableCursor`. */
function cycleIndex(current: number, delta: -1 | 1, length: number): number {
  return (current + delta + length) % length;
}

/**
 * Cycle a value through an ordered list, wrapping at both ends. `delta` is
 * 1 for forward, -1 for backward. Used by the filter pane's setting rows.
 */
function cycleValue<T>(values: readonly T[], current: T, delta: -1 | 1): T {
  const idx = values.indexOf(current);
  if (idx === -1) return values[0];
  return values[(idx + delta + values.length) % values.length];
}

// ---------------------------------------------------------------------------
// Filter pane constants and helpers (ENG-19)
// ---------------------------------------------------------------------------

/** Number of cursor-addressable rows in the filter settings pane. */
export const FILTER_ROW_COUNT = 8;

/** The rarities a tier row can cycle through, plus `undefined` for "no floor". */
const RARITY_VALUES: readonly (Rarity | undefined)[] = [
  undefined,
  "common",
  "magic",
  "rare",
  "unique",
];

/** The ilvl-offset values a row can cycle through, plus `undefined` for "not configured". */
const ILVL_OFFSET_VALUES: readonly (number | undefined)[] = [
  undefined,
  -5,
  -3,
  0,
  3,
  5,
  10,
];

/**
 * All 4 `ItemStat` values in a stable order matching the cursor rows.
 * Row 4-7 map to these indices: str, agi, vit, int.
 */
export const ALL_STATS: readonly ItemStat[] = ["str", "agi", "vit", "int"];

/** Row 0/1/2 -> tier 1/2/3 (tier 3 represents "tier 3+"); other rows -> undefined. */
const TIER_BY_ROW = [1, 2, 3] as const;

/**
 * Returns the dungeon tier key for a given filter row index.
 * Row 0 -> tier 1, row 1 -> tier 2, row 2 -> tier 3+ (represented as key 3).
 */
function tierForFilterRow(row: number): number | undefined {
  return TIER_BY_ROW[row];
}

/**
 * Returns the `ItemStat` for a given affix-toggle row index.
 * Row 4 -> str, row 5 -> agi, row 6 -> vit, row 7 -> int.
 */
function statForFilterRow(row: number): ItemStat | undefined {
  const index = row - 4;
  if (index >= 0 && index < ALL_STATS.length) return ALL_STATS[index];
  return undefined;
}

/**
 * Build a new `LootFilterRules` from the current filter and a single row
 * change. `cursor` tells us which row was activated; `delta` is 1 for
 * forward/cycle/toggle and -1 for backward cycle. Returns the full rules
 * object suitable for dispatching as `SetLootFilter`.
 */
export function cycleFilterRow(
  current: LootFilterRules,
  cursor: number,
  delta: -1 | 1,
): LootFilterRules {
  // Rarity-tier rows (0-2)
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

  // Ilvl-offset row (3)
  if (cursor === 3) {
    const nextOffset = cycleValue(
      ILVL_OFFSET_VALUES,
      current.minIlvlOffset,
      delta,
    );
    return { ...current, minIlvlOffset: nextOffset };
  }

  // Affix-toggle rows (4-7)
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
  /** Whether the currently selected gear item shows its full affix lines. */
  inspecting: boolean;
  /** Cursor into the consumables section's item list (ENG-4). */
  consumableCursor: number;
  /** Cursor into the filter settings pane's row list (ENG-19). */
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
  /** The gear section's rows, already sorted by the state's current `sortKey`. */
  packEntries: readonly PackEntry[];
  /** The consumables section's owned stacks (ENG-4). */
  consumables: readonly InventoryItem[];
  /** The current loot filter rules, read from GameState (ENG-19). */
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

// Gear-only bindings. `char:r` cycles the backpack sort key ("r" for
// re-sort - not bound by any other screen, and distinct from e/u/s and the
// cursor/member-switch keys already in use here). Enter toggles the inspect
// (full affix lines) view for the selected item, mirroring the Store's
// equip/unequip bindings for e/u.
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

// Consumables-only bindings (ENG-4). Up/down move the item cursor; left/right
// retarget which party member a use applies to (the shared `memberIndex`);
// `char:u` uses the selected item on the current target, mirroring the gear
// section's `u` (unequip) as "the letter that acts on the selected row".
const inventoryConsumablesKeymap: Keymap = {
  ...inventoryCommonKeymap,
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
  "char:u": { kind: "useItem" },
};

// Filter-pane bindings (ENG-19). Up/down move the row cursor; Enter/Left/Right
// cycle the selected row's value. Tab and Escape fall through to common.
const inventoryFilterKeymap: Keymap = {
  ...inventoryCommonKeymap,
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
  enter: { kind: "confirm" },
};

/** Resolves the `Intent` for a key press on the inventory screen, given its current section. */
export function resolveInventoryIntent(
  section: InventorySection,
  key: KeyName,
): Intent | undefined {
  if (section === "gear") return inventoryGearKeymap[key];
  if (section === "consumables") return inventoryConsumablesKeymap[key];
  if (section === "filter") return inventoryFilterKeymap[key];
  return inventoryCommonKeymap[key];
}

/** Pure transition function for the inventory screen's sections, sort, inspect, equip/unequip, and (ENG-4) field item use. */
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

  // The member switcher is shared between gear (equip target) and
  // consumables (heal target) - both sections let Left/Right retarget it.
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

  // Filter section (ENG-19): up/down move cursor, Enter/Left/Right cycle
  // the value at the cursor position and dispatch the updated rules.
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

  // Every other intent below only applies to the gear section (currency and
  // quest are read-only browses with no cursor/sort/equip actions).
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

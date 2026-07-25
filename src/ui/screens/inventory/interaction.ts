/**
 * Inventory screen input handling (ENG-3, workstream 1 of the ENG-2
 * inventory-system epic). This is the dedicated gear/consumables/currency/
 * quest browser that replaces `StoreView`'s `pack` mode as the canonical
 * place to inspect and equip gear; the Store's backpack mode now only sells.
 *
 * Gear section reuses `village/interaction.ts`'s `buildPackEntries`/
 * `EQUIP_SLOTS`/`PackEntry` and `engine/loot/equipment.ts`'s `compareItem`/
 * `equipTargetSlot` rather than duplicating pack-row/compare logic - this
 * module only adds what's new: section cycling, backpack sorting, and the
 * inspect toggle. Consumables/currency are read-only browses over
 * `GameState.inventory`/`gold`; quest has no backing data model yet (a
 * future workstream), so it renders as an explicit empty state.
 */

import type { EquipmentSlotName } from "../../../engine/loot/equipment";
import { itemBaseSlot, itemSellPrice } from "../../../engine/loot/items";
import type { ItemInstance, Rarity } from "../../../engine/loot/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";
import type { PackEntry } from "../village/interaction";

export type InventorySection = "gear" | "consumables" | "currency" | "quest";

const SECTIONS: readonly InventorySection[] = [
  "gear",
  "consumables",
  "currency",
  "quest",
];

/** Backpack sort keys, cycled by `cycleSort` (Tab-adjacent, see keymap below). */
export type SortKey = "rarity" | "ilvl" | "slot" | "value";

export const SORT_KEYS: readonly SortKey[] = [
  "rarity",
  "ilvl",
  "slot",
  "value",
];

const RARITY_ORDER: Record<Rarity, number> = {
  common: 0,
  magic: 1,
  rare: 2,
  unique: 3,
};

/**
 * Sorts a pack panel's backpack (non-equipped) rows by `sortKey`, leaving the
 * 4 equipped-slot rows pinned at the top in their original order, matching
 * the Store's pack panel layout. Rarity/ilvl/value sort highest-first (the
 * item you'd most want to look at first); slot sorts alphabetically. Pure -
 * ties keep their relative order (`Array#sort` is stable).
 */
export function sortPackEntries(
  entries: readonly PackEntry[],
  sortKey: SortKey,
): PackEntry[] {
  const equipped = entries.filter((entry) => entry.kind === "equipped");
  const backpack = entries.filter(
    (entry): entry is Extract<PackEntry, { kind: "backpack" }> =>
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

export interface InventoryUiState {
  section: InventorySection;
  memberIndex: number;
  packCursor: number;
  sortKey: SortKey;
  /** Whether the currently selected gear item shows its full affix lines. */
  inspecting: boolean;
}

export const INITIAL_INVENTORY_UI_STATE: InventoryUiState = {
  section: "gear",
  memberIndex: 0,
  packCursor: 0,
  sortKey: "rarity",
  inspecting: false,
};

export interface InventoryUiContext {
  partyLength: number;
  memberId: string;
  /** The gear section's rows, already sorted by the state's current `sortKey`. */
  packEntries: readonly PackEntry[];
}

export type InventoryUiEffect =
  | { type: "equip"; instanceId: string; memberId: string }
  | { type: "unequip"; slot: EquipmentSlotName; memberId: string }
  | { type: "back" };

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

/** Resolves the `Intent` for a key press on the inventory screen, given its current section. */
export function resolveInventoryIntent(
  section: InventorySection,
  key: KeyName,
): Intent | undefined {
  return section === "gear"
    ? inventoryGearKeymap[key]
    : inventoryCommonKeymap[key];
}

/** Pure transition function for the inventory screen's sections, sort, inspect, and equip/unequip. */
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
        inspecting: false,
      },
    };
  }

  // Every other intent below only applies to the gear section (the other
  // sections are read-only browses with no cursor/sort/equip actions).
  if (state.section !== "gear") return { state };

  if (
    (intent.kind === "menuLeft" || intent.kind === "menuRight") &&
    ctx.partyLength > 1
  ) {
    const delta = intent.kind === "menuLeft" ? -1 : 1;
    const next =
      (state.memberIndex + delta + ctx.partyLength) % ctx.partyLength;
    return {
      state: { ...state, memberIndex: next, packCursor: 0, inspecting: false },
    };
  }
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        packCursor:
          (state.packCursor + ctx.packEntries.length - 1) %
          ctx.packEntries.length,
        inspecting: false,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: {
        ...state,
        packCursor: (state.packCursor + 1) % ctx.packEntries.length,
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

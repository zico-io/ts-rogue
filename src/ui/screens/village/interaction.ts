/**
 * Village input handling (ROG-45; extracted from `VillageOverview.tsx`,
 * `InnView.tsx`, `ChurchView.tsx`, `StoreView.tsx`, and `TavernView.tsx`'s
 * inline `useInput` closures). Each sub-view keeps owning its own local UI
 * state via `useState` in its component; this module supplies the
 * `Keymap`/`resolveXIntent`/`reduceXUi` pair for each of them, mirroring
 * `title/interaction.ts`'s shape one sub-view at a time rather than as a
 * single mega state machine, since the five sub-views' states don't
 * otherwise interact.
 */

import { SHOP_ITEMS } from "../../../data/shops";
import type { EquipmentSlotName } from "../../../engine/loot/equipment";
import type { ItemInstance } from "../../../engine/loot/types";
import type { GameState } from "../../../engine/state/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";
// Type-only: `SortKey` is erased at compile time, so this doesn't create a
// runtime import cycle even though `inventory/interaction.ts` imports
// `PackEntry` (also type-only) from this module.
import type { SortKey } from "../inventory/interaction";
import type { VillageBuilding } from "./types";

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** A selectable row on the overview: a building sub-view, or leaving to the overworld. */
export interface MenuOption {
  key: VillageBuilding | "overworld";
  label: string;
  shortcut: string;
}

export const OPTIONS: readonly MenuOption[] = [
  { key: "inn", label: "Inn - rest and heal the party", shortcut: "i" },
  { key: "church", label: "Church - save your progress", shortcut: "c" },
  { key: "store", label: "Store - buy and sell items", shortcut: "s" },
  { key: "tavern", label: "Tavern - recruit party members", shortcut: "t" },
  { key: "stash", label: "Stash - store gear for later", shortcut: "x" },
  {
    key: "overworld",
    label: "Leave town - venture into the overworld",
    shortcut: "o",
  },
];

export interface OverviewUiState {
  cursor: number;
}

export type OverviewUiEffect =
  | { type: "enter"; building: VillageBuilding }
  | { type: "leave" };

export interface OverviewUiResult {
  state: OverviewUiState;
  effect?: OverviewUiEffect;
}

const overviewKeymap: Keymap = {
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirm" },
  "char:i": { kind: "shortcut", char: "i" },
  "char:c": { kind: "shortcut", char: "c" },
  "char:s": { kind: "shortcut", char: "s" },
  "char:t": { kind: "shortcut", char: "t" },
  "char:x": { kind: "shortcut", char: "x" },
  "char:o": { kind: "shortcut", char: "o" },
};

/** Resolves the `Intent` for a key press on the village overview. */
export function resolveOverviewIntent(key: KeyName): Intent | undefined {
  return overviewKeymap[key];
}

function overviewEffectFor(option: MenuOption): OverviewUiEffect {
  return option.key === "overworld"
    ? { type: "leave" }
    : { type: "enter", building: option.key };
}

/** Pure transition function for the village overview's option cursor. */
export function reduceOverviewUi(
  state: OverviewUiState,
  intent: Intent,
): OverviewUiResult {
  if (intent.kind === "menuUp") {
    return {
      state: { cursor: (state.cursor + OPTIONS.length - 1) % OPTIONS.length },
    };
  }
  if (intent.kind === "menuDown") {
    return { state: { cursor: (state.cursor + 1) % OPTIONS.length } };
  }
  if (intent.kind === "confirm") {
    return { state, effect: overviewEffectFor(OPTIONS[state.cursor]) };
  }
  if (intent.kind === "shortcut") {
    const option = OPTIONS.find((entry) => entry.shortcut === intent.char);
    return option ? { state, effect: overviewEffectFor(option) } : { state };
  }
  return { state };
}

// ---------------------------------------------------------------------------
// Inn
// ---------------------------------------------------------------------------

export type InnUiEffect = { type: "rest" } | { type: "back" };

const innKeymap: Keymap = {
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

/** Resolves the `Intent` for a key press in the Inn. */
export function resolveInnIntent(key: KeyName): Intent | undefined {
  return innKeymap[key];
}

/** The Inn has no local UI state; this maps its two intents straight to effects. */
export function reduceInnUi(intent: Intent): InnUiEffect | undefined {
  if (intent.kind === "confirm") return { type: "rest" };
  if (intent.kind === "cancel") return { type: "back" };
  return undefined;
}

// ---------------------------------------------------------------------------
// Church
// ---------------------------------------------------------------------------

export type ChurchUiEffect = { type: "save" } | { type: "back" };

const churchKeymap: Keymap = {
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

/** Resolves the `Intent` for a key press in the Church. */
export function resolveChurchIntent(key: KeyName): Intent | undefined {
  return churchKeymap[key];
}

/**
 * The Church has no local UI state; this maps its two intents straight to
 * effects. The save call itself is real I/O and stays in `ChurchView`'s
 * effect handling (like `startNewGame` does in `app.tsx`), not here.
 */
export function reduceChurchUi(intent: Intent): ChurchUiEffect | undefined {
  if (intent.kind === "confirm") return { type: "save" };
  if (intent.kind === "cancel") return { type: "back" };
  return undefined;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type StoreMode = "shop" | "pack";

export interface StoreUiState {
  mode: StoreMode;
  shopCursor: number;
  packCursor: number;
  memberIndex: number;
}

export const INITIAL_STORE_UI_STATE: StoreUiState = {
  mode: "shop",
  shopCursor: 0,
  packCursor: 0,
  memberIndex: 0,
};

export const EQUIP_SLOTS: readonly {
  slot: EquipmentSlotName;
  label: string;
}[] = [
  { slot: "weapon", label: "Weapon" },
  { slot: "armor", label: "Armor" },
  { slot: "accessory1", label: "Accessory 1" },
  { slot: "accessory2", label: "Accessory 2" },
];

export type PackEntry =
  | {
      kind: "equipped";
      slot: EquipmentSlotName;
      label: string;
      item: ItemInstance | null;
    }
  | { kind: "backpack"; item: ItemInstance };

/** Builds the pack panel's rows: the member's four equipment slots, then their backpack. */
export function buildPackEntries(
  member: GameState["party"][number],
  items: readonly ItemInstance[],
): PackEntry[] {
  return [
    ...EQUIP_SLOTS.map((entry) => ({
      kind: "equipped" as const,
      slot: entry.slot,
      label: entry.label,
      item: member.equipment[entry.slot],
    })),
    ...items.map((item) => ({ kind: "backpack" as const, item })),
  ];
}

export interface StoreUiContext {
  partyLength: number;
  memberId: string;
  packEntries: readonly PackEntry[];
}

// ENG-3: the Store's own keymap no longer emits `equip`/`unequip` - gear
// management moved to the dedicated Inventory screen (`screens/inventory`),
// which imports the shared `buildPackEntries`/`EQUIP_SLOTS`/`PackEntry`
// below directly rather than through this effect union.
export type StoreUiEffect =
  | { type: "storeBuy"; itemId: string }
  | { type: "storeSell"; itemId: string }
  | { type: "sellItem"; instanceId: string }
  | { type: "back" };

export interface StoreUiResult {
  state: StoreUiState;
  effect?: StoreUiEffect;
}

const storeCommonKeymap: Keymap = {
  escape: { kind: "cancel" },
  tab: { kind: "switchMode" },
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
};

const storeShopKeymap: Keymap = {
  ...storeCommonKeymap,
  "char:b": { kind: "buy" },
  "char:s": { kind: "sell" },
};

// ENG-3: equip/unequip moved to the dedicated Inventory screen; the
// Store's backpack mode is sell-only now that gear management lives there.
const storePackKeymap: Keymap = {
  ...storeCommonKeymap,
  "char:s": { kind: "sell" },
};

/** Resolves the `Intent` for a key press in the Store, given its current mode. */
export function resolveStoreIntent(
  mode: StoreMode,
  key: KeyName,
): Intent | undefined {
  return mode === "shop" ? storeShopKeymap[key] : storePackKeymap[key];
}

/** Pure transition function for the Store's shop/pack modes. */
export function reduceStoreUi(
  state: StoreUiState,
  intent: Intent,
  ctx: StoreUiContext,
): StoreUiResult {
  if (intent.kind === "cancel") return { state, effect: { type: "back" } };
  if (intent.kind === "switchMode") {
    return {
      state: {
        ...state,
        mode: state.mode === "shop" ? "pack" : "shop",
        shopCursor: 0,
        packCursor: 0,
      },
    };
  }
  if (
    (intent.kind === "menuLeft" || intent.kind === "menuRight") &&
    ctx.partyLength > 1
  ) {
    const delta = intent.kind === "menuLeft" ? -1 : 1;
    const next =
      (state.memberIndex + delta + ctx.partyLength) % ctx.partyLength;
    return { state: { ...state, memberIndex: next, packCursor: 0 } };
  }

  if (state.mode === "shop") {
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          shopCursor:
            (state.shopCursor + SHOP_ITEMS.length - 1) % SHOP_ITEMS.length,
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: {
          ...state,
          shopCursor: (state.shopCursor + 1) % SHOP_ITEMS.length,
        },
      };
    }
    const selected = SHOP_ITEMS[state.shopCursor];
    if (!selected) return { state };
    if (intent.kind === "buy") {
      return { state, effect: { type: "storeBuy", itemId: selected.id } };
    }
    if (intent.kind === "sell") {
      return { state, effect: { type: "storeSell", itemId: selected.id } };
    }
    return { state };
  }

  // mode === "pack"
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        packCursor:
          (state.packCursor + ctx.packEntries.length - 1) %
          ctx.packEntries.length,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: {
        ...state,
        packCursor: (state.packCursor + 1) % ctx.packEntries.length,
      },
    };
  }
  const packIndex = Math.min(state.packCursor, ctx.packEntries.length - 1);
  const selected = ctx.packEntries[packIndex];
  if (!selected) return { state };
  if (selected.kind === "backpack" && intent.kind === "sell") {
    return {
      state,
      effect: { type: "sellItem", instanceId: selected.item.instanceId },
    };
  }
  return { state };
}

// ---------------------------------------------------------------------------
// Tavern
// ---------------------------------------------------------------------------

export type TavernMode = "recruit" | "party";

export interface TavernUiState {
  mode: TavernMode;
  recruitCursor: number;
  partyCursor: number;
  confirmId: string | null;
}

export const INITIAL_TAVERN_UI_STATE: TavernUiState = {
  mode: "recruit",
  recruitCursor: 0,
  partyCursor: 0,
  confirmId: null,
};

export interface TavernUiContext {
  recruitsLength: number;
  partyMemberIds: readonly string[];
}

export type TavernUiEffect =
  | { type: "hire"; index: number }
  | { type: "dismiss"; memberId: string }
  | { type: "back" };

export interface TavernUiResult {
  state: TavernUiState;
  effect?: TavernUiEffect;
}

const tavernCommonKeymap: Keymap = {
  escape: { kind: "cancel" },
  tab: { kind: "switchMode" },
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirm" },
};

const tavernRecruitKeymap: Keymap = {
  ...tavernCommonKeymap,
  // "h" is a literal KeyName (shared with the hjkl movement keys), not
  // "char:h" - normalizeInkKey/normalizeBrowserKey special-case h/j/k/l
  // before falling through to the char: bucket.
  h: { kind: "hire" },
};

const tavernPartyKeymap: Keymap = {
  ...tavernCommonKeymap,
  "char:d": { kind: "dismiss" },
};

const tavernConfirmKeymap: Keymap = {
  escape: { kind: "cancel" },
  enter: { kind: "confirmYes" },
  "char:y": { kind: "confirmYes" },
  "char:n": { kind: "confirmNo" },
};

/** Resolves the `Intent` for a key press in the Tavern, given its mode and confirm dialog. */
export function resolveTavernIntent(
  mode: TavernMode,
  confirming: boolean,
  key: KeyName,
): Intent | undefined {
  if (mode === "party" && confirming) return tavernConfirmKeymap[key];
  return mode === "recruit" ? tavernRecruitKeymap[key] : tavernPartyKeymap[key];
}

/** Pure transition function for the Tavern's recruit/party modes and dismiss confirmation. */
export function reduceTavernUi(
  state: TavernUiState,
  intent: Intent,
  ctx: TavernUiContext,
): TavernUiResult {
  if (intent.kind === "cancel") {
    if (state.confirmId) return { state: { ...state, confirmId: null } };
    return { state, effect: { type: "back" } };
  }
  if (intent.kind === "switchMode") {
    return {
      state: {
        mode: state.mode === "recruit" ? "party" : "recruit",
        recruitCursor: 0,
        partyCursor: 0,
        confirmId: null,
      },
    };
  }

  if (state.mode === "recruit") {
    if (ctx.recruitsLength === 0) return { state };
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          recruitCursor:
            (state.recruitCursor + ctx.recruitsLength - 1) % ctx.recruitsLength,
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: {
          ...state,
          recruitCursor: (state.recruitCursor + 1) % ctx.recruitsLength,
        },
      };
    }
    if (intent.kind === "confirm" || intent.kind === "hire") {
      const index = Math.min(state.recruitCursor, ctx.recruitsLength - 1);
      return { state, effect: { type: "hire", index } };
    }
    return { state };
  }

  // mode === "party"
  if (state.confirmId) {
    if (intent.kind === "confirmYes") {
      return {
        state: { ...state, confirmId: null },
        effect: { type: "dismiss", memberId: state.confirmId },
      };
    }
    if (intent.kind === "confirmNo") {
      return { state: { ...state, confirmId: null } };
    }
    return { state };
  }
  if (ctx.partyMemberIds.length === 0) return { state };
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        partyCursor:
          (state.partyCursor + ctx.partyMemberIds.length - 1) %
          ctx.partyMemberIds.length,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: {
        ...state,
        partyCursor: (state.partyCursor + 1) % ctx.partyMemberIds.length,
      },
    };
  }
  if (intent.kind === "confirm" || intent.kind === "dismiss") {
    const partyIndex = Math.min(
      state.partyCursor,
      ctx.partyMemberIds.length - 1,
    );
    const memberId = ctx.partyMemberIds[partyIndex];
    // Index 0 is the hero and can never be dismissed.
    if (memberId && partyIndex !== 0) {
      return { state: { ...state, confirmId: memberId } };
    }
  }
  return { state };
}

// ---------------------------------------------------------------------------
// Stash
// ---------------------------------------------------------------------------

/** Extracts the always-populated `backpack`-kind rows (no equipped slots here). */
type BackpackEntry = Extract<PackEntry, { kind: "backpack" }>;

/**
 * Builds the Stash view's pane rows from a flat gear array (ENG-5). Unlike
 * `buildPackEntries`, there are no equipment slots to show here - `items`
 * and `stash` are party-shared (`GameState.items`/`GameState.stash`), not
 * per-member - so every row is the `backpack` `PackEntry` variant. Reusing
 * that shape lets both panes flow straight through the Inventory screen's
 * `sortPackEntries` without a separate sort implementation.
 */
export function buildStashEntries(items: readonly ItemInstance[]): PackEntry[] {
  return items.map((item) => ({ kind: "backpack" as const, item }));
}

export type StashMode = "backpack" | "stash";

export interface StashUiState {
  mode: StashMode;
  backpackCursor: number;
  stashCursor: number;
  sortKey: SortKey;
}

export const INITIAL_STASH_UI_STATE: StashUiState = {
  mode: "backpack",
  backpackCursor: 0,
  stashCursor: 0,
  sortKey: "rarity",
};

export interface StashUiContext {
  backpackEntries: readonly BackpackEntry[];
  stashEntries: readonly BackpackEntry[];
  /** The Inventory screen's `SORT_KEYS` cycle, passed in by the caller rather
   * than imported here to avoid a runtime import cycle with
   * `screens/inventory/interaction.ts` (which imports `PackEntry` from this
   * module). */
  sortKeys: readonly SortKey[];
}

export type StashUiEffect =
  | { type: "deposit"; instanceId: string }
  | { type: "withdraw"; instanceId: string }
  | { type: "back" };

export interface StashUiResult {
  state: StashUiState;
  effect?: StashUiEffect;
}

const stashCommonKeymap: Keymap = {
  escape: { kind: "cancel" },
  tab: { kind: "switchMode" },
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  "char:r": { kind: "cycleSort" },
};

const stashBackpackKeymap: Keymap = {
  ...stashCommonKeymap,
  "char:d": { kind: "deposit" },
};

const stashStashKeymap: Keymap = {
  ...stashCommonKeymap,
  "char:w": { kind: "withdraw" },
};

/** Resolves the `Intent` for a key press in the Stash, given its current mode. */
export function resolveStashIntent(
  mode: StashMode,
  key: KeyName,
): Intent | undefined {
  return mode === "backpack" ? stashBackpackKeymap[key] : stashStashKeymap[key];
}

/**
 * Pure transition function for the Stash's backpack/stash panes (ENG-5),
 * modeled on `reduceStoreUi`: Tab switches which pane the cursor and
 * deposit/withdraw target. Unlike the Store, `items`/`stash` are
 * party-shared rather than per-member, so there is no member switcher here.
 */
export function reduceStashUi(
  state: StashUiState,
  intent: Intent,
  ctx: StashUiContext,
): StashUiResult {
  if (intent.kind === "cancel") return { state, effect: { type: "back" } };
  if (intent.kind === "switchMode") {
    return {
      state: {
        ...state,
        mode: state.mode === "backpack" ? "stash" : "backpack",
      },
    };
  }
  if (intent.kind === "cycleSort") {
    const nextIndex =
      (ctx.sortKeys.indexOf(state.sortKey) + 1) % ctx.sortKeys.length;
    return { state: { ...state, sortKey: ctx.sortKeys[nextIndex] } };
  }

  if (state.mode === "backpack") {
    const length = ctx.backpackEntries.length;
    if (length === 0) return { state };
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          backpackCursor: (state.backpackCursor + length - 1) % length,
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: {
          ...state,
          backpackCursor: (state.backpackCursor + 1) % length,
        },
      };
    }
    if (intent.kind === "deposit") {
      const index = Math.min(state.backpackCursor, length - 1);
      const selected = ctx.backpackEntries[index];
      return selected
        ? {
            state,
            effect: { type: "deposit", instanceId: selected.item.instanceId },
          }
        : { state };
    }
    return { state };
  }

  // mode === "stash"
  const length = ctx.stashEntries.length;
  if (length === 0) return { state };
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        stashCursor: (state.stashCursor + length - 1) % length,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: { ...state, stashCursor: (state.stashCursor + 1) % length },
    };
  }
  if (intent.kind === "withdraw") {
    const index = Math.min(state.stashCursor, length - 1);
    const selected = ctx.stashEntries[index];
    return selected
      ? {
          state,
          effect: { type: "withdraw", instanceId: selected.item.instanceId },
        }
      : { state };
  }
  return { state };
}

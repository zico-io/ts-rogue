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

export type StoreUiEffect =
  | { type: "storeBuy"; itemId: string }
  | { type: "storeSell"; itemId: string }
  | { type: "sellItem"; instanceId: string }
  | { type: "equip"; instanceId: string; memberId: string }
  | { type: "unequip"; slot: EquipmentSlotName; memberId: string }
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

const storePackKeymap: Keymap = {
  ...storeCommonKeymap,
  "char:e": { kind: "equip" },
  "char:u": { kind: "unequip" },
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
    if (intent.kind === "sell") {
      return {
        state,
        effect: { type: "sellItem", instanceId: selected.item.instanceId },
      };
    }
    return { state };
  }
  if (intent.kind === "unequip") {
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
  "char:h": { kind: "hire" },
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

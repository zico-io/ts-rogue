import { type ShopItem, unlockedShopItems } from "../../../data/shops";
import type { EquipmentSlotName } from "../../../engine/loot/equipment";
import type { ItemInstance } from "../../../engine/loot/types";
import type { GameState } from "../../../engine/state/types";
import type { Intent, Keymap, KeyName } from "../../scene/input";

import type { SortKey } from "../inventory/interaction";
import type { VillageBuilding } from "./types";

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
  { key: "guild", label: "Guild - accept and turn in quests", shortcut: "g" },
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
  "char:g": { kind: "shortcut", char: "g" },
  "char:o": { kind: "shortcut", char: "o" },
};

export function resolveOverviewIntent(key: KeyName): Intent | undefined {
  return overviewKeymap[key];
}

function overviewEffectFor(option: MenuOption): OverviewUiEffect {
  return option.key === "overworld"
    ? { type: "leave" }
    : { type: "enter", building: option.key };
}

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

export type InnUiEffect = { type: "rest" } | { type: "back" };

const innKeymap: Keymap = {
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

export function resolveInnIntent(key: KeyName): Intent | undefined {
  return innKeymap[key];
}

export function reduceInnUi(intent: Intent): InnUiEffect | undefined {
  if (intent.kind === "confirm") return { type: "rest" };
  if (intent.kind === "cancel") return { type: "back" };
  return undefined;
}

export type ChurchUiEffect = { type: "save" } | { type: "back" };

const churchKeymap: Keymap = {
  enter: { kind: "confirm" },
  escape: { kind: "cancel" },
};

export function resolveChurchIntent(key: KeyName): Intent | undefined {
  return churchKeymap[key];
}

export function reduceChurchUi(intent: Intent): ChurchUiEffect | undefined {
  if (intent.kind === "confirm") return { type: "save" };
  if (intent.kind === "cancel") return { type: "back" };
  return undefined;
}

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

export type ShopRow =
  | { kind: "catalog"; item: ShopItem }
  | { kind: "rolled"; item: ItemInstance };

/** Combined, level-gated catalog + rare rolled stock, in cursor order (ENG-41). */
export function buildShopRows(
  level: number,
  rolledStock: readonly ItemInstance[],
): ShopRow[] {
  return [
    ...unlockedShopItems(level).map((item) => ({
      kind: "catalog" as const,
      item,
    })),
    ...rolledStock.map((item) => ({ kind: "rolled" as const, item })),
  ];
}

export interface StoreUiContext {
  partyLength: number;
  memberId: string;
  packEntries: readonly PackEntry[];
  shopRows: readonly ShopRow[];
}

export type StoreUiEffect =
  | { type: "storeBuy"; itemId: string }
  | { type: "storeSell"; itemId: string }
  | { type: "storeBuyRolled"; instanceId: string }
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

const storePackKeymap: Keymap = {
  ...storeCommonKeymap,
  "char:s": { kind: "sell" },
};

export function resolveStoreIntent(
  mode: StoreMode,
  key: KeyName,
): Intent | undefined {
  return mode === "shop" ? storeShopKeymap[key] : storePackKeymap[key];
}

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
    const rowCount = ctx.shopRows.length;
    if (rowCount === 0) return { state };
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          shopCursor: (state.shopCursor + rowCount - 1) % rowCount,
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: { ...state, shopCursor: (state.shopCursor + 1) % rowCount },
      };
    }
    const shopIndex = Math.min(state.shopCursor, rowCount - 1);
    const row = ctx.shopRows[shopIndex];
    if (!row) return { state };
    if (intent.kind === "buy") {
      return row.kind === "catalog"
        ? { state, effect: { type: "storeBuy", itemId: row.item.id } }
        : {
            state,
            effect: {
              type: "storeBuyRolled",
              instanceId: row.item.instanceId,
            },
          };
    }
    if (intent.kind === "sell" && row.kind === "catalog") {
      return { state, effect: { type: "storeSell", itemId: row.item.id } };
    }
    return { state };
  }

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

export function resolveTavernIntent(
  mode: TavernMode,
  confirming: boolean,
  key: KeyName,
): Intent | undefined {
  if (mode === "party" && confirming) return tavernConfirmKeymap[key];
  return mode === "recruit" ? tavernRecruitKeymap[key] : tavernPartyKeymap[key];
}

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

    if (memberId && partyIndex !== 0) {
      return { state: { ...state, confirmId: memberId } };
    }
  }
  return { state };
}

export type BackpackEntry = Extract<PackEntry, { kind: "backpack" }>;

export function buildStashEntries(
  items: readonly ItemInstance[],
): BackpackEntry[] {
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

export function resolveStashIntent(
  mode: StashMode,
  key: KeyName,
): Intent | undefined {
  return mode === "backpack" ? stashBackpackKeymap[key] : stashStashKeymap[key];
}

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

export type GuildMode = "available" | "accepted";

export interface GuildUiState {
  mode: GuildMode;
  availableCursor: number;
  acceptedCursor: number;
}

export const INITIAL_GUILD_UI_STATE: GuildUiState = {
  mode: "available",
  availableCursor: 0,
  acceptedCursor: 0,
};

export interface GuildAcceptedRow {
  id: string;
  complete: boolean;
}

export interface GuildUiContext {
  availableIds: readonly string[];
  acceptedQuests: readonly GuildAcceptedRow[];
}

export type GuildUiEffect =
  | { type: "accept"; questId: string }
  | { type: "turnIn"; questId: string }
  | { type: "back" };

export interface GuildUiResult {
  state: GuildUiState;
  effect?: GuildUiEffect;
}

const guildKeymap: Keymap = {
  escape: { kind: "cancel" },
  tab: { kind: "switchMode" },
  up: { kind: "menuUp" },
  down: { kind: "menuDown" },
  enter: { kind: "confirm" },
};

export function resolveGuildIntent(key: KeyName): Intent | undefined {
  return guildKeymap[key];
}

export function reduceGuildUi(
  state: GuildUiState,
  intent: Intent,
  ctx: GuildUiContext,
): GuildUiResult {
  if (intent.kind === "cancel") return { state, effect: { type: "back" } };
  if (intent.kind === "switchMode") {
    return {
      state: {
        mode: state.mode === "available" ? "accepted" : "available",
        availableCursor: 0,
        acceptedCursor: 0,
      },
    };
  }

  if (state.mode === "available") {
    const length = ctx.availableIds.length;
    if (length === 0) return { state };
    if (intent.kind === "menuUp") {
      return {
        state: {
          ...state,
          availableCursor: (state.availableCursor + length - 1) % length,
        },
      };
    }
    if (intent.kind === "menuDown") {
      return {
        state: {
          ...state,
          availableCursor: (state.availableCursor + 1) % length,
        },
      };
    }
    if (intent.kind === "confirm") {
      const index = Math.min(state.availableCursor, length - 1);
      const questId = ctx.availableIds[index];
      return questId
        ? { state, effect: { type: "accept", questId } }
        : { state };
    }
    return { state };
  }

  const length = ctx.acceptedQuests.length;
  if (length === 0) return { state };
  if (intent.kind === "menuUp") {
    return {
      state: {
        ...state,
        acceptedCursor: (state.acceptedCursor + length - 1) % length,
      },
    };
  }
  if (intent.kind === "menuDown") {
    return {
      state: { ...state, acceptedCursor: (state.acceptedCursor + 1) % length },
    };
  }
  if (intent.kind === "confirm") {
    const index = Math.min(state.acceptedCursor, length - 1);
    const row = ctx.acceptedQuests[index];
    return row?.complete
      ? { state, effect: { type: "turnIn", questId: row.id } }
      : { state };
  }
  return { state };
}

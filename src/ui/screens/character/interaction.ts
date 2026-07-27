import type {
  PartyMember,
  PartyMemberStats,
} from "../../../engine/entities/party";
import { effectiveStats } from "../../../engine/loot/equipment";
import type { Intent, Keymap, KeyName } from "../../scene/input";

export interface CharacterUiState {
  memberIndex: number;
}

export const INITIAL_CHARACTER_UI_STATE: CharacterUiState = { memberIndex: 0 };

export type CharacterUiEffect = { type: "back" };

export interface CharacterUiResult {
  state: CharacterUiState;
  effect?: CharacterUiEffect;
}

export interface CharacterUiContext {
  partyLength: number;
}

const characterKeymap: Keymap = {
  left: { kind: "menuLeft" },
  right: { kind: "menuRight" },
  escape: { kind: "cancel" },
};

export function resolveCharacterIntent(key: KeyName): Intent | undefined {
  return characterKeymap[key];
}

export function reduceCharacterUi(
  state: CharacterUiState,
  intent: Intent,
  ctx: CharacterUiContext,
): CharacterUiResult {
  if (intent.kind === "cancel") return { state, effect: { type: "back" } };
  if (
    (intent.kind === "menuLeft" || intent.kind === "menuRight") &&
    ctx.partyLength > 1
  ) {
    const delta = intent.kind === "menuLeft" ? -1 : 1;
    const next =
      (state.memberIndex + delta + ctx.partyLength) % ctx.partyLength;
    return { state: { memberIndex: next } };
  }
  return { state };
}

const STAT_LABEL: Record<keyof PartyMemberStats, string> = {
  str: "STR",
  agi: "AGI",
  vit: "VIT",
  int: "INT",
};

export interface StatRow {
  key: keyof PartyMemberStats;
  label: string;
  base: number;
  bonus: number;
  total: number;
}

// Base stats plus the equipment bonus effectiveStats folds in, broken out
// per stat so the sheet can show both numbers instead of only the total.
export function buildStatRows(member: PartyMember): StatRow[] {
  const total = effectiveStats(member);
  return (Object.keys(STAT_LABEL) as (keyof PartyMemberStats)[]).map((key) => ({
    key,
    label: STAT_LABEL[key],
    base: member.stats[key],
    bonus: total[key] - member.stats[key],
    total: total[key],
  }));
}

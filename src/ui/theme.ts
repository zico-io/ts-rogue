import type { Element, StatusEffectId } from "../engine/combat/statusEffects";
import type { LogKind } from "../engine/state/types";

export const theme = {
  text: "#f2f2da",
  textMuted: "#a59b9d",

  textFaint: "#706a80",

  border: "#444f8d",
  borderFocus: "#e3aa3e",

  background: "#000000",
  title: "#c6b4b1",

  window: {
    fill: "#1b2a63",
  },

  accent: "#e3aa3e",
  danger: "#e74343",
  warn: "#f8a64c",
  heal: "#5fae3b",
  mp: "#23b4e9",
  gold: "#fbc254",

  msg: {
    damage: "#fa7d66",
    loot: "#fbc254",
    quest: "#ca7ef2",
    system: "#837d83",
  } satisfies Record<LogKind, string>,

  // Colors an incoming hit's damage line by its element so fire, ice,
  // lightning, and poison damage each read distinctly in the battle log.
  // Physical keeps the plain damage color as the neutral baseline.
  element: {
    physical: "#fa7d66",
    fire: "#f6642c",
    ice: "#8fe3ff",
    lightning: "#f5e042",
    poison: "#8fd13f",
  } satisfies Record<Element, string>,

  // Colors for afflicted-actor status badges in BattleScreen.
  statusEffect: {
    poison: "#8fd13f",
    burn: "#f6642c",
    stun: "#f8a64c",
    slow: "#6f8fa8",
    wet: "#3dc8f5",
    oiled: "#c98a3f",
    chilled: "#8fe3ff",
    frozen: "#bfe9ff",
    shocked: "#f5e042",
  } satisfies Record<StatusEffectId, string>,

  rarity: {
    common: "#c6b4b1",
    magic: "#1793e6",
    rare: "#fee284",
    unique: "#ca7ef2",
  },

  biome: {
    grass: "#6fc93f",
    forest: "#2f9350",

    mountain: "#9c8a6e",
    water: "#3dc8f5",
    village: "#fbc254",
    dungeonEntrance: "#ca7ef2",
    player: "#f2f2da",

    shore: "#d9b872",

    leaf: "#c98a3f",
    firefly: "#f6e27a",
    shimmer: "#d9fbff",
  },

  logoGradient: ["#ee99bf", "#cd67a8", "#ab4bab", "#8648b5", "#70388c"],

  gameOverGradient: ["#f9ab8f", "#fa7d66", "#e74343", "#b7383c", "#823439"],
} as const;

export const DUNGEON_RAMPS: readonly (readonly string[])[] = [
  ["#1c2b39", "#2c5a5f", "#5c9a7b", "#f3b45a"],
  ["#232043", "#453f7a", "#8a6f9c", "#f5b563"],
  ["#2a1f22", "#5c2f2c", "#a94f3a", "#f9b355"],
];

export function dungeonRamp(dungeonId: string): readonly string[] {
  const n = Number.parseInt(dungeonId.split("-")[1] ?? "", 10);
  const index = Number.isNaN(n) ? 0 : n % DUNGEON_RAMPS.length;
  return DUNGEON_RAMPS[index];
}

export function hpColor(hp: number, maxHp: number): string {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio <= 0.25) return theme.danger;
  if (ratio <= 0.5) return theme.warn;
  return theme.heal;
}

export function mpColor(mp: number, maxMp: number): string {
  const ratio = maxMp > 0 ? mp / maxMp : 0;
  return ratio <= 0.25 ? theme.textFaint : theme.mp;
}

export function bar(value: number, max: number, width: number): string {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  let filled = Math.round(ratio * width);
  if (value > 0 && filled === 0) filled = 1;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function toPixiColor(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

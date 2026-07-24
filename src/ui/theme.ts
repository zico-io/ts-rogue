/**
 * Visual identity tokens (ROG-31). Every raw color in the UI lives here —
 * components consume semantic tokens, never hex strings. Palette: the branded
 * 64-swatch ramp set attached to ROG-31.
 *
 * ponytail: no terminal-capability detection — Ink routes hex through chalk,
 * which downsamples truecolor -> 256 -> 16 by itself.
 */

import type { LogKind } from "../engine/state/types";

export const theme = {
  // text hierarchy
  text: "#f2f2da",
  textMuted: "#a59b9d",
  // Blue-leaning faint (not the palette's #6c6678): pure darks downsample to
  // invisible ANSI black on 16-color terminals, this keeps a visible blue.
  textFaint: "#706a80",
  // chrome
  // Palette indigo rather than the gray ramp for the same 16-color reason.
  border: "#444f8d",
  borderFocus: "#e3aa3e",
  // The void behind every scene's content - matches the terminal's own
  // implicit black background (Ink never paints one) and the Pixi
  // `Application`'s clear color (ROG-63), so a browser panel that doesn't
  // fully cover its content region reads as dark, not as a bleed of
  // `border`'s indigo.
  background: "#000000",
  title: "#c6b4b1",
  // JRPG windowskin fill (ROG-64, art direction §5) - the navy body behind the
  // HUD chrome's beveled panel, replacing the old flat `background`/`border`
  // combo there. `text` on this fill is ~11.9:1, well clear of the >=4.5:1
  // body-text goal (art direction §7).
  window: {
    fill: "#1b2a63",
  },
  // accent + states
  accent: "#e3aa3e",
  danger: "#e74343",
  warn: "#f8a64c",
  heal: "#5fae3b",
  mp: "#23b4e9",
  gold: "#fbc254",
  // message log kinds
  msg: {
    damage: "#fa7d66",
    loot: "#fbc254",
    quest: "#ca7ef2",
    system: "#837d83",
  } satisfies Record<LogKind, string>,
  // item rarity
  rarity: {
    common: "#c6b4b1",
    magic: "#1793e6",
    rare: "#fee284",
    unique: "#ca7ef2",
  },
  // overworld biomes + player
  biome: {
    grass: "#5fae3b",
    forest: "#21804c",
    mountain: "#837d83",
    water: "#23b4e9",
    village: "#fbc254",
    dungeonEntrance: "#ca7ef2",
    player: "#f2f2da",
  },
  // title logo gradient, one hex per logo line (pink -> purple)
  logoGradient: ["#ee99bf", "#cd67a8", "#ab4bab", "#8648b5", "#70388c"],
  // game-over banner gradient (red ramp, bright -> dark)
  gameOverGradient: ["#f9ab8f", "#fa7d66", "#e74343", "#b7383c", "#823439"],
} as const;

/** Per-dungeon first-person view ramps, index = depth band - 1 (far -> near). */
export const DUNGEON_RAMPS: readonly (readonly string[])[] = [
  ["#3a747a", "#419885", "#53c09f", "#87cead"], // dungeon-0: teal
  ["#444f8d", "#5c60b8", "#817cd4", "#ab8ee4"], // dungeon-1: indigo
  ["#823439", "#b7383c", "#e74343", "#fa7d66"], // dungeon-2: ember
];

/** Ramp for a dungeon id of the form `dungeon-N`; unknown ids get ramp 0. */
export function dungeonRamp(dungeonId: string): readonly string[] {
  const n = Number.parseInt(dungeonId.split("-")[1] ?? "", 10);
  const index = Number.isNaN(n) ? 0 : n % DUNGEON_RAMPS.length;
  return DUNGEON_RAMPS[index];
}

/** HP color by remaining fraction: healthy, hurt (≤0.5), critical (≤0.25). */
export function hpColor(hp: number, maxHp: number): string {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio <= 0.25) return theme.danger;
  if (ratio <= 0.5) return theme.warn;
  return theme.heal;
}

/** MP color: normal, faint when nearly empty (≤0.25). Zero max reads faint. */
export function mpColor(mp: number, maxMp: number): string {
  const ratio = maxMp > 0 ? mp / maxMp : 0;
  return ratio <= 0.25 ? theme.textFaint : theme.mp;
}

/** Fixed-width meter string, e.g. `███████░░░`. Nonzero values show ≥1 tick. */
export function bar(value: number, max: number, width: number): string {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  let filled = Math.round(ratio * width);
  if (value > 0 && filled === 0) filled = 1;
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Packs a `#rrggbb` hex color string into the `0xRRGGBB` int Pixi's `Color`,
 * tint, and fill APIs accept. The browser renderer reads theme tokens as hex
 * strings (same as the terminal) and converts at the Pixi boundary here,
 * instead of the theme module knowing anything about Pixi.
 */
export function toPixiColor(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

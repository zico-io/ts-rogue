/**
 * Tileset rendering via the kitty graphics protocol's Unicode placeholder
 * mode (Ghostty/kitty). Each named tile below is a small pre-sliced PNG in
 * `assets/tiles/` (see `scripts/build-tiles.ts`), transmitted once at startup
 * with its own image id and one virtual placement; each map cell is then
 * plain text - U+10EEEE plus row/column diacritics, with the foreground
 * color carrying the image id and the underline color the placement id - so
 * Ink lays out, diffs, and moves tiles exactly like any other text. Inside
 * tmux the APC commands (only) are wrapped in the DCS passthrough envelope;
 * tmux must have `allow-passthrough on`.
 *
 * Everything else in the UI keeps its glyph path: screens consult
 * `tilesSupported()` and fall back to ASCII when tiles are off.
 */

import { readFileSync } from "node:fs";

const PLACEHOLDER = "\u{10EEEE}";
/** First 8 entries of kitty's row/column-diacritics table (indices 0..7). */
const DIACRITICS = ["̅", "̍", "̎", "̐", "̒", "̽", "̾", "̿"];

/** Cell footprint of battle monster sprites, exported for battle layout math. */
export const SPRITE_CELLS = { width: 8, height: 4 };

export interface TileSource {
  col: number;
  row: number;
  /** Cell footprint; defaults to 2x1 (a near-square block for a 12px tile). */
  cells?: { c: number; r: number };
}

const MONSTER_CELLS = { c: SPRITE_CELLS.width, r: SPRITE_CELLS.height };

/**
 * Semantic name -> sheet position. Coordinates are tile (col,row) picks on
 * the Urizen sheet; `scripts/build-tiles.ts` slices these into the per-tile
 * PNGs under `assets/tiles/` that are actually transmitted (terminals ignore
 * kitty source rects on virtual placements, so each tile is its own image).
 */
export const TILE_SOURCES = {
  // overworld terrain + player
  grass: { col: 4, row: 9 },
  forest: { col: 0, row: 34 },
  mountain: { col: 17, row: 34 },
  water: { col: 4, row: 41 },
  village: { col: 16, row: 33 },
  dungeonEntrance: { col: 30, row: 3 },
  player: { col: 127, row: 0 },
  // dungeon minimap
  wall: { col: 22, row: 2 },
  floor: { col: 2, row: 5 },
  chest: { col: 26, row: 5 },
  stairsDown: { col: 13, row: 40 },
  boss: { col: 140, row: 29 },
  // battle sprites (monster ids from src/data/monsters.ts)
  slime: { col: 105, row: 42, cells: MONSTER_CELLS },
  goblin: { col: 114, row: 36, cells: MONSTER_CELLS },
  "dungeon-guardian": { col: 140, row: 29, cells: MONSTER_CELLS },
} satisfies Record<string, TileSource>;

export type TileName = keyof typeof TILE_SOURCES;

const NAMES = Object.keys(TILE_SOURCES) as TileName[];

/** Image id: registry position + 1 (all < 255, so `38;5;id` works). */
function imageId(name: TileName): number {
  return NAMES.indexOf(name) + 1;
}

/** Every image gets exactly one virtual placement, always with this id. */
const PLACEMENT_ID = 1;

export function hasTile(name: string): name is TileName {
  return name in TILE_SOURCES;
}

let supported: boolean | undefined;

/** Env sniff: Ghostty/kitty only, and never when TSROGUE_NO_TILES is set. */
export function tilesSupported(): boolean {
  supported ??=
    !process.env.TSROGUE_NO_TILES &&
    Boolean(
      process.env.GHOSTTY_RESOURCES_DIR ||
        process.env.TERM?.includes("ghostty") ||
        process.env.KITTY_WINDOW_ID,
    );
  return supported;
}

/** Wrap an escape sequence in the tmux DCS passthrough envelope if needed. */
export function tmuxWrap(
  sequence: string,
  inTmux: boolean = Boolean(process.env.TMUX),
): string {
  if (!inTmux) return sequence;
  return `\x1bPtmux;${sequence.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
}

function apc(payload: string): string {
  return `\x1b_G${payload}\x1b\\`;
}

/** Direct chunked transmission: 4096-byte base64 chunks (m=1 until the last). */
const CHUNK = 4096;

/**
 * Transmit-plus-placement sequence for one tile image (base64-encoded PNG).
 * Direct (in-band) medium - the file medium `t=f` fails silently in some
 * terminals - and one image per tile, because terminals ignore kitty source
 * rects (`x,y,w,h`) on virtual placements.
 */
export function initSequence(
  images: ReadonlyArray<[TileName, string]>,
  inTmux?: boolean,
): string {
  const commands: string[] = [];
  for (const [name, pngBase64] of images) {
    const id = imageId(name);
    for (let i = 0; i < pngBase64.length; i += CHUNK) {
      const chunk = pngBase64.slice(i, i + CHUNK);
      const last = i + CHUNK >= pngBase64.length;
      const control =
        i === 0
          ? `a=t,f=100,i=${id},q=2,m=${last ? 0 : 1}`
          : `m=${last ? 0 : 1}`;
      commands.push(apc(`${control};${chunk}`));
    }
    const source: TileSource = TILE_SOURCES[name];
    const { c, r } = source.cells ?? { c: 2, r: 1 };
    commands.push(apc(`a=p,U=1,q=2,i=${id},p=${PLACEMENT_ID},c=${c},r=${r}`));
  }
  return commands.map((command) => tmuxWrap(command, inTmux)).join("");
}

let initialized = false;

/**
 * Transmit every tile image and create its placement. Must run after Ink
 * enters the alternate screen - kitty graphics storage is per-screen.
 */
export function initTiles(): void {
  if (initialized || !tilesSupported()) return;
  initialized = true;
  const images = NAMES.map((name): [TileName, string] => {
    const path = new URL(`../../../assets/tiles/${name}.png`, import.meta.url)
      .pathname;
    return [name, readFileSync(path).toString("base64")];
  });
  process.stdout.write(initSequence(images));
  // ponytail: no image delete on exit; the terminal frees it with the session
}

/** One placeholder line: cells (0..cols-1) of `row` for the given image. */
function placeholderLine(id: number, row: number, cols: number): string {
  let cells = "";
  for (let col = 0; col < cols; col++) {
    cells += PLACEHOLDER + DIACRITICS[row] + DIACRITICS[col];
  }
  return `\x1b[38;5;${id}m\x1b[58;5;${PLACEMENT_ID}m${cells}\x1b[59;39m`;
}

const tileTextCache = new Map<TileName, string>();

/** A single 2x1-cell tile as an Ink-safe text run (2 columns wide). */
export function tileText(name: TileName): string {
  let text = tileTextCache.get(name);
  if (text === undefined) {
    text = placeholderLine(imageId(name), 0, 2);
    tileTextCache.set(name, text);
  }
  return text;
}

/** A battle sprite as one text run per terminal row (each 8 columns wide). */
export function spriteRows(name: TileName): string[] {
  const id = imageId(name);
  const rows: string[] = [];
  for (let row = 0; row < SPRITE_CELLS.height; row++) {
    rows.push(placeholderLine(id, row, SPRITE_CELLS.width));
  }
  return rows;
}

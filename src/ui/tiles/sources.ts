/**
 * Tile-sheet coordinate registry: semantic frame name -> a rect on a vendored
 * Minifantasy sheet (ROG-68). This is the single source of truth for the
 * browser (Pixi) atlas - `scripts/build-atlas.ts` crops these rects into
 * `src/web/public/atlas/*` and the web renderer references frames by
 * `TileName`. The terminal renderer is pure ASCII and does not use this table.
 *
 * Minifantasy is split across packs, so unlike the old single-sheet Urizen
 * table every frame names its own `sheet`. All source art is native 8x8; a few
 * frames crop a taller/wider region (a 2-tile tree, a building) that the atlas
 * builder resizes down to the shared 8x8 output grid.
 */

/** Vendored Minifantasy sheets under `assets/minifantasy/`, keyed for the atlas builder. */
export const SHEETS = {
  forgottenPlains: "forgotten_plains.png",
  overworldProps: "overworld_props.png",
  constructions: "constructions.png",
  dungeonTileset: "dungeon_tileset.png",
  dungeonProps: "dungeon_props.png",
  humanIdle: "human_idle.png",
} satisfies Record<string, string>;

export type SheetName = keyof typeof SHEETS;

export interface TileSource {
  sheet: SheetName;
  /** Source rect in sheet pixels; resized to the 8x8 output frame at build time. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 8px tile helpers so coordinates read as (col,row) picks on a sheet. */
const T = 8;
const at = (sheet: SheetName, col: number, row: number, cols = 1, rows = 1) =>
  ({ sheet, x: col * T, y: row * T, w: cols * T, h: rows * T }) as const;

export const TILE_SOURCES = {
  // Overworld terrain (Minifantasy Tiny Overworld - Forgotten Plains, 8x8).
  grass: at("forgottenPlains", 19, 4),
  water: at("forgottenPlains", 1, 6),
  mountain: at("forgottenPlains", 16, 5, 1, 2), // mossy boulder, 2 tiles tall
  // Same mossy-boulder family as `mountain`, cropped from adjacent smaller/
  // larger rock formations on the same sheet (color-matched, ROG-73) so a
  // dense mountain cluster reads as visually bigger/fuller than an isolated
  // one, not just the same crop rescaled - see `overworldVariants.ts`.
  mountainSmall: { sheet: "forgottenPlains", x: 124, y: 24, w: 12, h: 8 },
  mountainLarge: { sheet: "forgottenPlains", x: 148, y: 32, w: 12, h: 24 },
  forest: at("overworldProps", 0, 7, 2, 2), // leafy tree, canopy + trunk
  // Overworld points of interest (Tiny Overworld - Constructions). Single-tile
  // markers cropped from multi-tile structures; interim reads pending the
  // dedicated Towns pack (ROG-65), which was not in the ROG-68 asset drop.
  village: at("constructions", 1, 13, 4, 4), // stone keep
  dungeonEntrance: at("constructions", 6, 0, 3, 3), // gatehouse + door
  // Player marker: top-down Minifantasy Dungeon human, first idle frame cropped
  // to the character's pixel bounds (the sprite sits at 13,12 in the 32x32 frame).
  player: { sheet: "humanIdle", x: 13, y: 12, w: 6, h: 7 },
  // Dungeon scene (Minifantasy Dungeon, 8x8): wall/floor for the raycaster +
  // minimap, plus the billboarded feature markers (chest/stairs/boss).
  wall: at("dungeonTileset", 1, 2),
  floor: at("dungeonTileset", 13, 2),
  chest: at("dungeonProps", 23, 0, 2, 2),
  stairsDown: at("dungeonTileset", 15, 9), // dark pitted brick, stands in for a stair down
  boss: at("dungeonProps", 1, 7, 1, 2), // gravestone, boss-room marker
} satisfies Record<string, TileSource>;

export type TileName = keyof typeof TILE_SOURCES;

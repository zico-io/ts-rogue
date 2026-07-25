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
 * builder resizes down to the shared 8x8 output grid by default.
 *
 * A frame can opt into `multiCell` (ENG-8) to keep its natural multi-cell
 * size instead of that squish - see the field doc below and
 * `src/web/render/pixiOverworldDrawFactory.ts` for how a draw call turns
 * that into one sub-region sprite per covered grid cell.
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

/** A texture's footprint in output grid cells. */
export interface Footprint {
  wide: number;
  high: number;
}

export interface TileSource {
  sheet: SheetName;
  /** Source rect in sheet pixels; resized to the 8x8 output frame at build time, unless `multiCell` says otherwise. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Declares this texture's natural footprint in output grid cells (ENG-8)
   * instead of the default single-cell squish. When present, the atlas
   * builder keeps the crop at `wide*8 x high*8` pixels (still resized with
   * nearest-neighbor from its source rect, just not squashed down to one
   * cell) instead of resizing it to a single 8x8 frame, and the renderer
   * places one sub-region sprite per covered grid cell so the whole texture
   * reads as one continuous image spanning that many cells - not a single
   * squished-and-rescaled sprite, and not tiled repeats of a 1x1 frame.
   */
  multiCell?: Footprint;
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
  // ENG-8 fixture: exercises the multi-cell texture mapping end-to-end (atlas
  // packing + Pixi draw path) - reuses the leafy-tree crop above (already a
  // real, vendored 2-wide x 2-tall canopy+trunk asset) but keeps its natural
  // footprint instead of squishing it into one cell, so it renders as one
  // continuous image across a 2x2 block of grid cells. Not drawn by any live
  // overworld tile - actually placing a multi-cell landmark on the map is
  // ENG-7; this is only the enabling capability, shown via a `?dev` debug
  // overlay (see `bootGame.ts`'s `renderOverworldContent`).
  multiCellFixture: {
    ...at("overworldProps", 0, 7, 2, 2),
    multiCell: { wide: 2, high: 2 },
  },
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

/** A texture's footprint in output grid cells - 1x1 unless it declares `multiCell`. */
export function footprintOf(name: TileName): Footprint {
  return (TILE_SOURCES[name] as TileSource).multiCell ?? { wide: 1, high: 1 };
}

/** Every cell a texture's footprint covers, as (col,row) offsets from its top-left anchor, row-major. */
export function footprintCells(
  name: TileName,
): Array<{ col: number; row: number }> {
  const { wide, high } = footprintOf(name);
  const cells: Array<{ col: number; row: number }> = [];
  for (let row = 0; row < high; row++) {
    for (let col = 0; col < wide; col++) cells.push({ col, row });
  }
  return cells;
}

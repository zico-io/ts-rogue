/**
 * Tile-sheet coordinate registry: semantic name -> position on the Urizen
 * sheet. This is the single source of truth for the browser (Pixi) atlas -
 * `scripts/build-atlas.ts` slices these coordinates into `src/web/public/atlas/*`
 * and the web renderer references frames by `TileName`. The terminal renderer
 * is pure ASCII and does not use this table.
 */

export interface TileSource {
  col: number;
  row: number;
  /** Cell footprint; defaults to 2x1 (a near-square block for a 12px tile). */
  cells?: { c: number; r: number };
}

const MONSTER_CELLS = { c: 8, r: 4 };

/**
 * Coordinates are tile (col,row) picks on the Urizen sheet;
 * `scripts/build-atlas.ts` crops and downsamples these into the browser atlas.
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

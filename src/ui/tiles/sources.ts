export const SHEETS = {
  forgottenPlains: "forgotten_plains.png",
  overworldProps: "overworld_props.png",
  constructions: "constructions.png",
  dungeonTileset: "dungeon_tileset.png",
  dungeonProps: "dungeon_props.png",
  humanIdle: "human_idle.png",
} satisfies Record<string, string>;

export type SheetName = keyof typeof SHEETS;

export interface Footprint {
  wide: number;
  high: number;
}

export interface TileSource {
  sheet: SheetName;

  x: number;
  y: number;
  w: number;
  h: number;

  multiCell?: Footprint;
}

const T = 8;
const at = (sheet: SheetName, col: number, row: number, cols = 1, rows = 1) =>
  ({ sheet, x: col * T, y: row * T, w: cols * T, h: rows * T }) as const;

export const TILE_SOURCES = {
  // A hand-picked flat crop from the same mossy-hill illustration the old
  // (19,4) grass crop used, but shifted a few pixels to land fully inside its
  // solid-green fill instead of clipping the hill's gray rock shading at the
  // top/right edge (WEB-6: the old crop baked visible rock-gray noise into
  // every grass tile).
  grass: { sheet: "forgottenPlains", x: 150, y: 34, w: 8, h: 8 },
  // The sheet's only water is two small illustrated ponds, not a tileable
  // swatch, so every crop has some shoreline bleed. This 8x4 strip is the
  // largest pure-water rectangle in either pond (0 land pixels); the atlas
  // pipeline's nearest-neighbor resize to 8x8 doubles each source row rather
  // than pulling in the pond's grassy edge (WEB-6: the old (1,6) crop was
  // ~40/64 water, the rest muddy green/brown shoreline).
  water: { sheet: "forgottenPlains", x: 6, y: 41, w: 8, h: 4 },
  mountain: at("forgottenPlains", 16, 5, 1, 2),

  mountainSmall: { sheet: "forgottenPlains", x: 124, y: 24, w: 12, h: 8 },
  mountainLarge: { sheet: "forgottenPlains", x: 148, y: 32, w: 12, h: 24 },
  forest: at("overworldProps", 0, 7, 2, 2),

  // Small ground clutter scattered sparsely over grass (overworldVariants.ts
  // `grassDecoration`) so the biome reads as more than one repeated tile
  // (WEB-6). Four self-contained ~4x4 icons from the same props sheet the
  // tree comes from: a plain tuft plus a flower/pebble accent each.
  grassTuft: { sheet: "overworldProps", x: 4, y: 76, w: 4, h: 4 },
  grassFlowerYellow: { sheet: "overworldProps", x: 20, y: 76, w: 4, h: 4 },
  grassFlowerPink: { sheet: "overworldProps", x: 12, y: 84, w: 4, h: 4 },
  grassPebble: { sheet: "overworldProps", x: 44, y: 76, w: 4, h: 4 },

  village: {
    ...at("constructions", 1, 13, 4, 4),
    multiCell: { wide: 2, high: 2 },
  },
  dungeonEntrance: at("constructions", 6, 0, 3, 3),

  multiCellFixture: {
    ...at("overworldProps", 0, 7, 2, 2),
    multiCell: { wide: 2, high: 2 },
  },

  player: { sheet: "humanIdle", x: 13, y: 12, w: 6, h: 7 },

  wall: at("dungeonTileset", 1, 2),
  floor: at("dungeonTileset", 13, 2),
  chest: at("dungeonProps", 23, 0, 2, 2),
  stairsDown: at("dungeonTileset", 15, 9),
  boss: at("dungeonProps", 1, 7, 1, 2),
} satisfies Record<string, TileSource>;

export type TileName = keyof typeof TILE_SOURCES;

export function footprintOf(name: TileName): Footprint {
  return (TILE_SOURCES[name] as TileSource).multiCell ?? { wide: 1, high: 1 };
}

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

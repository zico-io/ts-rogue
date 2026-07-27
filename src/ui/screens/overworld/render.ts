import { LANDMARK_FOOTPRINTS } from "../../../engine/world/landmarks";
import {
  MINIMAP_SCALE,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from "../../../engine/world/overworld";
import type { OverworldMap, Point, Tile } from "../../../engine/world/types";
import { theme } from "../../theme";
import type { TileName } from "../../tiles/sources";

export interface TileGlyph {
  char: string;
  color: string;
}

export interface Cell extends TileGlyph {
  key: string;

  x: number;
  y: number;

  tile?: TileName;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface MinimapOptions {
  scale?: number;

  maxWidth?: number;

  maxHeight?: number;
}

const TILE_GLYPHS: Record<Tile, TileGlyph> = {
  grass: { char: ".", color: theme.biome.grass },
  forest: { char: "%", color: theme.biome.forest },
  mountain: { char: "^", color: theme.biome.mountain },
  water: { char: "~", color: theme.biome.water },
  village: { char: "H", color: theme.biome.village },
  dungeonEntrance: { char: "D", color: theme.biome.dungeonEntrance },
};

export const PLAYER_GLYPH: TileGlyph = { char: "@", color: theme.biome.player };

// The village's 2x2 footprint reads as one small settlement - a peaked roof
// over a wall with a door and a window - instead of four repeated glyphs.
const VILLAGE_FOOTPRINT_GLYPHS: readonly (readonly TileGlyph[])[] = [
  [
    { char: "/", color: theme.biome.village },
    { char: "\\", color: theme.biome.village },
  ],
  [
    { char: "H", color: theme.biome.village },
    { char: "n", color: theme.biome.village },
  ],
];

export function glyphFor(tile: Tile): TileGlyph {
  return TILE_GLYPHS[tile];
}

/** Glyph for a specific map cell, resolving multi-tile landmark footprints. */
export function glyphAt(map: OverworldMap, point: Point): TileGlyph {
  const tile = map.tiles[point.y][point.x];
  if (tile === "village") {
    const footprint = LANDMARK_FOOTPRINTS.village;
    const dx = point.x - map.village.x;
    const dy = point.y - map.village.y;
    if (dx >= 0 && dx < footprint.width && dy >= 0 && dy < footprint.height) {
      return VILLAGE_FOOTPRINT_GLYPHS[dy][dx];
    }
  }
  return glyphFor(tile);
}

function resolveDim(
  value: number | undefined,
  mapSize: number,
  fallback: number,
): number {
  if (value === undefined) return Math.min(fallback, mapSize);
  return Math.max(1, Math.min(Math.floor(value), mapSize));
}

export function cameraOrigin(
  focus: number,
  viewportSize: number,
  mapSize: number,
): number {
  const centered = focus - Math.floor(viewportSize / 2);
  return Math.max(0, Math.min(centered, Math.max(0, mapSize - viewportSize)));
}

export function buildViewportRows(
  map: OverworldMap,
  player: Point,
  viewport?: Viewport,
): Cell[][] {
  const width = resolveDim(viewport?.width, map.width, VIEWPORT_WIDTH);
  const height = resolveDim(viewport?.height, map.height, VIEWPORT_HEIGHT);
  const originX = cameraOrigin(player.x, width, map.width);
  const originY = cameraOrigin(player.y, height, map.height);
  const rows: Cell[][] = [];
  for (let y = originY; y < originY + height; y++) {
    const row: Cell[] = [];
    for (let x = originX; x < originX + width; x++) {
      const isPlayer = x === player.x && y === player.y;
      const glyph = isPlayer ? PLAYER_GLYPH : glyphAt(map, { x, y });
      const tile = isPlayer ? "player" : map.tiles[y][x];
      row.push({ ...glyph, key: `${x},${y}`, x, y, tile });
    }
    rows.push(row);
  }
  return rows;
}

function sampleBlock(
  map: OverworldMap,
  blockX: number,
  blockY: number,
  scale: number,
): Tile {
  let terrain: Tile = "grass";
  let waypoint: Tile | undefined;
  const startX = blockX * scale;
  const startY = blockY * scale;
  for (let y = startY; y < Math.min(startY + scale, map.height); y++) {
    for (let x = startX; x < Math.min(startX + scale, map.width); x++) {
      const tile = map.tiles[y][x];
      if (tile === "dungeonEntrance") return tile;
      if (tile === "village") waypoint = tile;
      else terrain = tile;
    }
  }
  return waypoint ?? terrain;
}

function resolveMinimapScale(
  map: OverworldMap,
  options?: MinimapOptions,
): number {
  if (options?.scale !== undefined) {
    return Math.max(1, Math.min(Math.floor(options.scale), map.width));
  }
  const maxWidth = options?.maxWidth;
  const maxHeight = options?.maxHeight;
  if (maxWidth === undefined && maxHeight === undefined) return MINIMAP_SCALE;
  const maxScale = 8;
  for (let scale = MINIMAP_SCALE; scale <= maxScale; scale++) {
    const w = Math.ceil(map.width / scale);
    const h = Math.ceil(map.height / scale);
    const fitsW = maxWidth === undefined || w <= maxWidth;
    const fitsH = maxHeight === undefined || h <= maxHeight;
    if (fitsW && fitsH) return scale;
  }
  return maxScale;
}

export function buildMinimapRows(
  map: OverworldMap,
  player: Point,
  options?: MinimapOptions,
): Cell[][] {
  const scale = resolveMinimapScale(map, options);
  const minimapWidth = Math.ceil(map.width / scale);
  const minimapHeight = Math.ceil(map.height / scale);
  const playerBlock = {
    x: Math.floor(player.x / scale),
    y: Math.floor(player.y / scale),
  };
  const rows: Cell[][] = [];
  for (let by = 0; by < minimapHeight; by++) {
    const row: Cell[] = [];
    for (let bx = 0; bx < minimapWidth; bx++) {
      const isPlayer = bx === playerBlock.x && by === playerBlock.y;
      const glyph = isPlayer
        ? PLAYER_GLYPH
        : glyphFor(sampleBlock(map, bx, by, scale));
      row.push({ ...glyph, key: `${bx},${by}`, x: bx, y: by });
    }
    rows.push(row);
  }
  return rows;
}

export function formatEncounterMeter(
  meter: number,
  threshold: number,
  barWidth = 20,
): string {
  const percent = Math.min(
    100,
    Math.max(0, Math.round((meter / threshold) * 100)),
  );
  const filled = Math.round((percent / 100) * barWidth);
  const bar = "#".repeat(filled) + ".".repeat(barWidth - filled);
  return `[${bar}] ${percent}%`;
}

/**
 * Pure rendering helpers for the overworld screen: tile glyphs, the
 * camera-follow viewport, and the downsampled minimap. No Ink/React import
 * here so this stays trivially unit-testable; `OverworldScreen.tsx` is the
 * thin Ink wrapper around it.
 *
 * The viewport and minimap both scale to the terminal size the screen passes
 * in: the viewport window grows or shrinks (clamped to the map), and the
 * minimap downsamples more (a larger scale) when its pane is narrow so it
 * always fits without clipping.
 */

import {
  MINIMAP_SCALE,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from "../../../engine/world/overworld";
import type { OverworldMap, Point, Tile } from "../../../engine/world/types";

export interface TileGlyph {
  char: string;
  color: string;
}

export interface Cell extends TileGlyph {
  key: string;
}

/** Integer viewport dimensions in tiles. */
export interface Viewport {
  width: number;
  height: number;
}

/** Options for sizing the minimap. */
export interface MinimapOptions {
  /** Fixed downsample scale (tiles per minimap cell); overrides the bounds. */
  scale?: number;
  /** Max minimap width in cells; the scale grows to fit within this. */
  maxWidth?: number;
  /** Max minimap height in cells; the scale grows to fit within this. */
  maxHeight?: number;
}

const TILE_GLYPHS: Record<Tile, TileGlyph> = {
  grass: { char: ".", color: "green" },
  forest: { char: "%", color: "green" },
  mountain: { char: "^", color: "gray" },
  water: { char: "~", color: "blue" },
  village: { char: "H", color: "yellow" },
  dungeonEntrance: { char: "D", color: "magenta" },
};

export const PLAYER_GLYPH: TileGlyph = { char: "@", color: "white" };

export function glyphFor(tile: Tile): TileGlyph {
  return TILE_GLYPHS[tile];
}

/** Clamp a viewport dimension to `[1, mapSize]`, defaulting to `fallback`. */
function resolveDim(
  value: number | undefined,
  mapSize: number,
  fallback: number,
): number {
  if (value === undefined) return Math.min(fallback, mapSize);
  return Math.max(1, Math.min(Math.floor(value), mapSize));
}

/** Clamp a viewport origin so `[origin, origin + size)` stays inside `[0, mapSize)`, centered on `focus`. */
export function cameraOrigin(
  focus: number,
  viewportSize: number,
  mapSize: number,
): number {
  const centered = focus - Math.floor(viewportSize / 2);
  return Math.max(0, Math.min(centered, Math.max(0, mapSize - viewportSize)));
}

/** Camera-follow viewport around the player, as rows of renderable cells. */
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
      const glyph = isPlayer ? PLAYER_GLYPH : glyphFor(map.tiles[y][x]);
      row.push({ ...glyph, key: `${x},${y}` });
    }
    rows.push(row);
  }
  return rows;
}

/** Village/dungeon entrance tiles win over plain terrain within a downsampled block. */
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

/**
 * Pick the smallest downsample scale (largest minimap) that fits the bounds,
 * starting from {@link MINIMAP_SCALE} and growing only when the default would
 * not fit. An explicit `scale` wins; with no bounds the default scale is used.
 */
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

/** Whole-map overview downsampled by the resolved scale, with the player marked. */
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
      row.push({ ...glyph, key: `${bx},${by}` });
    }
    rows.push(row);
  }
  return rows;
}

/** Renders the encounter meter as a fixed-width text bar, e.g. `[####......] 42%`. */
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

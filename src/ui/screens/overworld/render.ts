/**
 * Pure rendering helpers for the overworld screen: tile glyphs, the
 * camera-follow viewport, and the downsampled minimap. No Ink/React import
 * here so this stays trivially unit-testable; `OverworldScreen.tsx` is the
 * thin Ink wrapper around it.
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

/** Clamp a viewport origin so `[origin, origin + size)` stays inside `[0, mapSize)`, centered on `focus`. */
export function cameraOrigin(
  focus: number,
  viewportSize: number,
  mapSize: number,
): number {
  const centered = focus - Math.floor(viewportSize / 2);
  return Math.max(0, Math.min(centered, mapSize - viewportSize));
}

/** Camera-follow viewport around the player, as rows of renderable cells. */
export function buildViewportRows(map: OverworldMap, player: Point): Cell[][] {
  const originX = cameraOrigin(player.x, VIEWPORT_WIDTH, map.width);
  const originY = cameraOrigin(player.y, VIEWPORT_HEIGHT, map.height);
  const rows: Cell[][] = [];
  for (let y = originY; y < originY + VIEWPORT_HEIGHT; y++) {
    const row: Cell[] = [];
    for (let x = originX; x < originX + VIEWPORT_WIDTH; x++) {
      const isPlayer = x === player.x && y === player.y;
      const glyph = isPlayer ? PLAYER_GLYPH : glyphFor(map.tiles[y][x]);
      row.push({ ...glyph, key: `${x},${y}` });
    }
    rows.push(row);
  }
  return rows;
}

/** Village/dungeon entrance tiles win over plain terrain within a downsampled block. */
function sampleBlock(map: OverworldMap, blockX: number, blockY: number): Tile {
  let terrain: Tile = "grass";
  let waypoint: Tile | undefined;
  const startX = blockX * MINIMAP_SCALE;
  const startY = blockY * MINIMAP_SCALE;
  for (let y = startY; y < Math.min(startY + MINIMAP_SCALE, map.height); y++) {
    for (let x = startX; x < Math.min(startX + MINIMAP_SCALE, map.width); x++) {
      const tile = map.tiles[y][x];
      if (tile === "dungeonEntrance") return tile;
      if (tile === "village") waypoint = tile;
      else terrain = tile;
    }
  }
  return waypoint ?? terrain;
}

/** Whole-map overview downsampled by `MINIMAP_SCALE`, with the player marked. */
export function buildMinimapRows(map: OverworldMap, player: Point): Cell[][] {
  const minimapWidth = Math.ceil(map.width / MINIMAP_SCALE);
  const minimapHeight = Math.ceil(map.height / MINIMAP_SCALE);
  const playerBlock = {
    x: Math.floor(player.x / MINIMAP_SCALE),
    y: Math.floor(player.y / MINIMAP_SCALE),
  };
  const rows: Cell[][] = [];
  for (let by = 0; by < minimapHeight; by++) {
    const row: Cell[] = [];
    for (let bx = 0; bx < minimapWidth; bx++) {
      const isPlayer = bx === playerBlock.x && by === playerBlock.y;
      const glyph = isPlayer
        ? PLAYER_GLYPH
        : glyphFor(sampleBlock(map, bx, by));
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

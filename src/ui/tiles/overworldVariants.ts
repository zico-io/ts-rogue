/**
 * Pure neighbor-driven terrain variant helpers for the browser overworld
 * renderer (ROG-73, "leverage Tiny Overworld auto tiling of terrain"). The
 * vendored Tiny Overworld crop (`assets/minifantasy/forgotten_plains.png`,
 * ROG-68) is a small preview swatch, not a full autotile blob sheet, so
 * rather than invent source rects this "auto-tiles" by transforming the
 * existing single-frame grass/water/mountain/forest/village/dungeonEntrance
 * sprites at draw time:
 *
 * - a water tile bordering land grows a shore-tinted fringe on the land
 *   side(s) ({@link shoreSides});
 * - a mountain/forest tile in a denser same-type cluster renders larger than
 *   an isolated one ({@link clusterScale}, driven by {@link sameNeighborCount});
 * - a village/dungeonEntrance landmark gets a small per-instance size
 *   variation ({@link landmarkScale}) instead of every instance reading
 *   identically.
 *
 * Framework-free, pure, and deterministic - {@link landmarkScale} hashes the
 * tile coordinate instead of calling `Math.random`, so a given map always
 * renders the same way and this stays unit-testable
 * (`overworldVariants.test.ts`). Consumed only by `render/overworldView.ts`;
 * the terminal renderer is pure ASCII and never imports this.
 */

import type { OverworldMap, Tile } from "../../engine/world/types";

/** Which orthogonal sides of a tile border non-matching terrain. */
export interface Sides {
  north: boolean;
  east: boolean;
  south: boolean;
  west: boolean;
}

const NO_SIDES: Sides = {
  north: false,
  east: false,
  south: false,
  west: false,
};

function tileAt(map: OverworldMap, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || y >= map.height || x >= map.width) return undefined;
  return map.tiles[y][x];
}

/** Count of the 4 orthogonal neighbors sharing `tile`'s type; out of bounds never counts. */
export function sameNeighborCount(
  map: OverworldMap,
  x: number,
  y: number,
  tile: Tile,
): number {
  let count = 0;
  if (tileAt(map, x, y - 1) === tile) count++;
  if (tileAt(map, x + 1, y) === tile) count++;
  if (tileAt(map, x, y + 1) === tile) count++;
  if (tileAt(map, x - 1, y) === tile) count++;
  return count;
}

/** Smallest scale (an isolated tile, 0 same-type neighbors) to largest (surrounded on all 4 sides). */
export function clusterScale(sameNeighbors: number): number {
  const MIN_SCALE = 0.8;
  const MAX_SCALE = 1.3;
  const clamped = Math.min(4, Math.max(0, sameNeighbors));
  return MIN_SCALE + ((MAX_SCALE - MIN_SCALE) / 4) * clamped;
}

/** Which orthogonal sides of a water tile border non-water land - `NO_SIDES` for any other tile. */
export function shoreSides(map: OverworldMap, x: number, y: number): Sides {
  if (tileAt(map, x, y) !== "water") return NO_SIDES;
  const isLand = (t: Tile | undefined) => t !== undefined && t !== "water";
  return {
    north: isLand(tileAt(map, x, y - 1)),
    east: isLand(tileAt(map, x + 1, y)),
    south: isLand(tileAt(map, x, y + 1)),
    west: isLand(tileAt(map, x - 1, y)),
  };
}

/** True if any side of `sides` borders land - i.e. this water tile needs a shore fringe drawn. */
export function hasShore(sides: Sides): boolean {
  return sides.north || sides.east || sides.south || sides.west;
}

/** Deterministic unit-interval hash of a tile coordinate - never `Math.random` (keeps renderer output reproducible). */
function positionHash(x: number, y: number): number {
  const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  return (h % 1000) / 1000;
}

/** Small per-instance size variety for a landmark marker (village/dungeonEntrance). */
export function landmarkScale(x: number, y: number): number {
  const MIN_SCALE = 0.9;
  const MAX_SCALE = 1.15;
  return MIN_SCALE + positionHash(x, y) * (MAX_SCALE - MIN_SCALE);
}

/**
 * Pure neighbor-driven terrain variant helpers for the browser overworld
 * renderer (ROG-73, "leverage Tiny Overworld auto tiling of terrain"). The
 * vendored Minifantasy Tiny Overworld packs (ROG-68) don't ship a
 * documented bitmask autotile blob table for cross-biome edges - the one
 * sheet that looks like it (`Minifantasy_TinyOverworldBiomesMergingTileset`,
 * attached to ROG-68 but not vendored here) uses dithered pixel-art blends
 * between arbitrary biome pairs with no legend, which isn't safely
 * hand-croppable without a way to visually verify the result - a real
 * follow-up once that's needed. So this "auto-tiles" with what the vendored
 * `forgotten_plains.png`/`overworld_props.png` sheets actually contain -
 * real, distinctly-sized objects already drawn by the artist - plus draw-time
 * transforms:
 *
 * - a water tile bordering land grows a shore-tinted fringe on the land
 *   side(s) ({@link shoreSides});
 * - a mountain tile in a denser same-type cluster swaps to a genuinely
 *   larger rock-formation crop from the same sheet family
 *   ({@link mountainTexture}) and scales up ({@link clusterScale}); a forest
 *   tile scales the same way without a texture swap (no verified distinct
 *   tree-size crops on the vendored props sheet);
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
import type { TileName } from "./sources";

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

/**
 * Which `mountain*` atlas frame to draw for a mountain tile with this many
 * same-type orthogonal neighbors - `mountainSmall`/`mountain`/`mountainLarge`
 * are color-matched crops of the same mossy-boulder formation at three
 * genuinely different sizes on `forgotten_plains.png` (ROG-73), not one
 * crop rescaled, so a dense cluster shows real extra rock detail instead of
 * just a bigger blur.
 */
export function mountainTexture(sameNeighbors: number): TileName {
  if (sameNeighbors <= 1) return "mountainSmall";
  if (sameNeighbors <= 3) return "mountain";
  return "mountainLarge";
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

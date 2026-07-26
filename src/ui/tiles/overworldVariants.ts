import type { OverworldMap, Tile } from "../../engine/world/types";
import type { TileName } from "./sources";

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

export function clusterScale(sameNeighbors: number): number {
  const MIN_SCALE = 0.8;
  const MAX_SCALE = 1.3;
  const clamped = Math.min(4, Math.max(0, sameNeighbors));
  return MIN_SCALE + ((MAX_SCALE - MIN_SCALE) / 4) * clamped;
}

export function mountainTexture(sameNeighbors: number): TileName {
  if (sameNeighbors <= 1) return "mountainSmall";
  if (sameNeighbors <= 3) return "mountain";
  return "mountainLarge";
}

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

export function hasShore(sides: Sides): boolean {
  return sides.north || sides.east || sides.south || sides.west;
}

function positionHash(x: number, y: number): number {
  const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  return (h % 1000) / 1000;
}

// A second, differently-salted hash so two independent rolls (whether to
// decorate, which decoration to use) don't collapse to the same value for a
// given cell.
function saltedHash(x: number, y: number, salt: number): number {
  return positionHash(x + salt * 92821, y + salt * 31337);
}

export function landmarkScale(x: number, y: number): number {
  const MIN_SCALE = 0.9;
  const MAX_SCALE = 1.15;
  return MIN_SCALE + positionHash(x, y) * (MAX_SCALE - MIN_SCALE);
}

// Sparse ground clutter for grass tiles (WEB-6): most grass cells stay plain,
// but a deterministic minority get a small flower/tuft/pebble on top so a
// field of grass reads as more than one repeated tile.
export const GRASS_DECORATIONS: readonly TileName[] = [
  "grassTuft",
  "grassFlowerYellow",
  "grassFlowerPink",
  "grassPebble",
];

const GRASS_DECORATION_DENSITY = 0.16;

export function grassDecoration(x: number, y: number): TileName | undefined {
  if (saltedHash(x, y, 1) >= GRASS_DECORATION_DENSITY) return undefined;
  const index = Math.min(
    GRASS_DECORATIONS.length - 1,
    Math.floor(saltedHash(x, y, 2) * GRASS_DECORATIONS.length),
  );
  return GRASS_DECORATIONS[index];
}

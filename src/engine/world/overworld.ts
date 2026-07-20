/**
 * Overworld generation and traversal rules (PROJECT_PLAN Phase 2, §4.3).
 *
 * The map is a pure function of a single numeric seed: `generateOverworldMap`
 * never reads or writes `GameState.rngState`, so it can be (re)computed on
 * demand from `GameState.seed` instead of being duplicated into the
 * serialized state tree. Calling it twice with the same seed always returns
 * an identical map (same tiles, same village, same dungeon entrances).
 */

import { Rng } from "../rng/rng";
import type { OverworldMap, Point, Tile, WorldState } from "./types";

export const OVERWORLD_WIDTH = 42;
export const OVERWORLD_HEIGHT = 21;

/** Camera viewport size for the follow-cam (PROJECT_PLAN Phase 2 deliverable). */
export const VIEWPORT_WIDTH = 21;
export const VIEWPORT_HEIGHT = 11;

/** Tiles per minimap cell; both map dimensions divide evenly by this. */
export const MINIMAP_SCALE = 3;

/** Encounter meter value that triggers a battle (PROJECT_PLAN §4.3). */
export const ENCOUNTER_THRESHOLD = 100;

const DUNGEON_ENTRANCE_COUNT = 3;
const VILLAGE_SAFE_RADIUS = 2;
const MIN_ENTRANCE_DISTANCE = 10;

interface Blob {
  tile: Tile;
  count: number;
  minRadius: number;
  maxRadius: number;
}

const BLOBS: readonly Blob[] = [
  { tile: "forest", count: 6, minRadius: 2, maxRadius: 4 },
  { tile: "mountain", count: 5, minRadius: 2, maxRadius: 4 },
  { tile: "water", count: 4, minRadius: 2, maxRadius: 3 },
];

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Impassable tiles block movement; every other tile can be walked onto. */
export function isPassable(tile: Tile): boolean {
  return tile !== "mountain" && tile !== "water";
}

/**
 * Per-step encounter danger for a biome (PROJECT_PLAN §4.3). Waypoint tiles
 * carry no danger of their own - they trigger a scene change instead.
 */
export function biomeDanger(tile: Tile): number {
  switch (tile) {
    case "grass":
      return 6;
    case "forest":
      return 14;
    default:
      return 0;
  }
}

export function inBounds(map: OverworldMap, point: Point): boolean {
  return (
    point.x >= 0 && point.x < map.width && point.y >= 0 && point.y < map.height
  );
}

export function tileAt(map: OverworldMap, point: Point): Tile {
  return map.tiles[point.y][point.x];
}

function paintBlob(
  tiles: Tile[][],
  rng: Rng,
  tile: Tile,
  width: number,
  height: number,
  minRadius: number,
  maxRadius: number,
): void {
  const center: Point = { x: rng.int(0, width - 1), y: rng.int(0, height - 1) };
  const radius = rng.int(minRadius, maxRadius);
  for (
    let y = Math.max(0, center.y - radius);
    y <= Math.min(height - 1, center.y + radius);
    y++
  ) {
    for (
      let x = Math.max(0, center.x - radius);
      x <= Math.min(width - 1, center.x + radius);
      x++
    ) {
      const distance = Math.hypot(x - center.x, y - center.y);
      const edgeJitter = rng.next() * 1.2;
      if (distance <= radius - 1 + edgeJitter) {
        tiles[y][x] = tile;
      }
    }
  }
}

function clearSafeArea(
  tiles: Tile[][],
  center: Point,
  radius: number,
  width: number,
  height: number,
): void {
  for (
    let y = Math.max(0, center.y - radius);
    y <= Math.min(height - 1, center.y + radius);
    y++
  ) {
    for (
      let x = Math.max(0, center.x - radius);
      x <= Math.min(width - 1, center.x + radius);
      x++
    ) {
      tiles[y][x] = "grass";
    }
  }
}

/** BFS over passable tiles from `start`; returns every tile reachable on foot. */
function reachableFrom(
  tiles: Tile[][],
  width: number,
  height: number,
  start: Point,
): Point[] {
  const visited = new Set<string>();
  const key = (p: Point) => `${p.x},${p.y}`;
  const queue: Point[] = [start];
  visited.add(key(start));
  const reached: Point[] = [];
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length checked above
    const current = queue.shift()!;
    reached.push(current);
    const neighbors: Point[] = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    for (const neighbor of neighbors) {
      if (
        neighbor.x < 0 ||
        neighbor.x >= width ||
        neighbor.y < 0 ||
        neighbor.y >= height
      )
        continue;
      const neighborKey = key(neighbor);
      if (visited.has(neighborKey)) continue;
      if (!isPassable(tiles[neighbor.y][neighbor.x])) continue;
      visited.add(neighborKey);
      queue.push(neighbor);
    }
  }
  return reached;
}

/**
 * Generate a deterministic overworld for `seed`. Scatters forest/mountain/
 * water blobs onto a grass base, guarantees the village's surroundings are
 * walkable, then places dungeon entrances only on tiles reachable on foot
 * from the village (so the playable slice - walk from the village to a
 * dungeon entrance - is always possible).
 */
export function generateOverworldMap(seed: number): OverworldMap {
  const width = OVERWORLD_WIDTH;
  const height = OVERWORLD_HEIGHT;
  const rng = new Rng(seed);

  const tiles: Tile[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => "grass" as Tile),
  );

  for (const blob of BLOBS) {
    for (let i = 0; i < blob.count; i++) {
      paintBlob(
        tiles,
        rng,
        blob.tile,
        width,
        height,
        blob.minRadius,
        blob.maxRadius,
      );
    }
  }

  const village: Point = { x: 3, y: Math.floor(height / 2) };
  clearSafeArea(tiles, village, VILLAGE_SAFE_RADIUS, width, height);
  tiles[village.y][village.x] = "village";

  const reached = reachableFrom(tiles, width, height, village);

  let minDistance = MIN_ENTRANCE_DISTANCE;
  let candidates: Point[] = [];
  while (candidates.length < DUNGEON_ENTRANCE_COUNT && minDistance >= 0) {
    candidates = reached.filter(
      (point) =>
        (tiles[point.y][point.x] === "grass" ||
          tiles[point.y][point.x] === "forest") &&
        chebyshev(point, village) >= minDistance,
    );
    minDistance -= 2;
  }

  const dungeonEntrances: Point[] = [];
  const pool = [...candidates];
  for (let i = 0; i < DUNGEON_ENTRANCE_COUNT && pool.length > 0; i++) {
    const index = rng.int(0, pool.length - 1);
    const [chosen] = pool.splice(index, 1);
    dungeonEntrances.push(chosen);
    tiles[chosen.y][chosen.x] = "dungeonEntrance";
  }

  return {
    width,
    height,
    tiles,
    village,
    dungeonEntrances,
  };
}

/** Starting `worldState` for a fresh run: the player begins on the village tile. */
export function createInitialWorldState(map: OverworldMap): WorldState {
  return { player: { ...map.village }, encounterMeter: 0 };
}

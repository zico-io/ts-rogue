/**
 * Dungeon generation, movement, fog-of-war, and encounter triggers
 * (PROJECT_PLAN Phase 3, ROG-9).
 *
 * A dungeon floor is a pure function of `seed + dungeonId + floor`:
 * {@link generateDungeonLayout} derives a deterministic floor seed from those
 * three inputs and feeds it to rot.js's `Map.Digger` room+corridor generator.
 * Digger consumes the *global* rot.js RNG singleton, so generation saves and
 * restores that singleton's state and reseeds it with the floor seed, keeping
 * the engine's serialized `rngState` untouched and the layout reproducible.
 * The player's wandering-encounter rolls still route through the seeded
 * `Rng` wrapper (see the `StepDungeon` reducer), so all randomness is
 * deterministic from the seed plus the event history.
 */

import { RNG, Map as RotMap } from "rot-js";
import { Rng } from "../rng/rng";
import type {
  DungeonFacing,
  DungeonFeature,
  DungeonLayout,
  DungeonState,
  DungeonTile,
  Point,
} from "./types";

/** Dungeon grid dimensions (fixed so the explored mask always aligns). */
export const DUNGEON_WIDTH = 28;
export const DUNGEON_HEIGHT = 20;

/** Number of floors in a dungeon; the last floor holds the boss room. */
export const DUNGEON_FLOORS = 3;

/** Chebyshev radius (in tiles) revealed around the player on each move. */
export const FOV_RADIUS = 3;

/**
 * Per-step chance of a wandering encounter on a plain floor tile. Tuned in
 * the Phase 6 balance pass (ROG-12) to 0.12 so a floor yields a few encounters
 * across its ~20-40 walkable tiles without spamming the crawl.
 */
export const DUNGEON_ENCOUNTER_CHANCE = 0.12;

/** Facing the party starts with on every freshly entered floor. */
export const DUNGEON_INITIAL_FACING: DungeonFacing = "north";

const FACINGS: readonly DungeonFacing[] = ["north", "east", "south", "west"];

const FORWARD_DELTA: Record<DungeonFacing, Point> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

/** One-tile step delta in the given facing (used by the StepDungeon reducer). */
export function forwardDelta(facing: DungeonFacing): Point {
  return FORWARD_DELTA[facing];
}

/** Rotate a facing 90 degrees left (counter-clockwise) or right (clockwise). */
export function rotateFacing(
  facing: DungeonFacing,
  direction: "left" | "right",
): DungeonFacing {
  const index = FACINGS.indexOf(facing);
  const offset = direction === "right" ? 1 : -1;
  return FACINGS[(index + offset + FACINGS.length) % FACINGS.length];
}

export function inDungeonBounds(layout: DungeonLayout, point: Point): boolean {
  return (
    point.x >= 0 &&
    point.x < layout.width &&
    point.y >= 0 &&
    point.y < layout.height
  );
}

/** Treats out-of-bounds as a wall so the FP renderer and movement agree. */
export function isDungeonWall(layout: DungeonLayout, point: Point): boolean {
  if (!inDungeonBounds(layout, point)) return true;
  return layout.tiles[point.y][point.x].wall;
}

export function tileFeature(
  layout: DungeonLayout,
  point: Point,
): DungeonFeature {
  if (!inDungeonBounds(layout, point)) return "none";
  return layout.tiles[point.y][point.x].feature;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Deterministic 32-bit FNV-1a hash over the string form of the parts. Used to
 * fold `seed + dungeonId + floor` into a single rot.js seed without consuming
 * the engine's `rngState`.
 */
function hashSeed(parts: Array<number | string>): number {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/**
 * Numeric seed for a dungeon floor, deterministic from `seed + dungeonId +
 * floor`. Clamped to >= 1 because rot.js's `setSeed` divides by seeds < 1.
 */
export function floorSeed(
  seed: number,
  dungeonId: string,
  floor: number,
): number {
  return Math.max(1, hashSeed([seed, dungeonId, floor]));
}

/**
 * Structural stand-in for a rot.js `Map.Feature.Room`. rot.js does not export
 * the `Room` type from its top-level entry, so we type only the methods the
 * generator uses; the real `Room[]` from `getRooms()` is structurally compatible.
 */
interface DungeonRoom {
  getCenter(): number[];
  getLeft(): number;
  getRight(): number;
  getTop(): number;
  getBottom(): number;
}

function roomCenter(room: { getCenter(): number[] }): Point {
  const [x, y] = room.getCenter();
  return { x, y };
}

/**
 * Pick the tile for the floor's objective (stairs down, or the boss marker on
 * the last floor): the center of the room farthest from the entrance. If the
 * dungeon generated a single room, fall back to that room's farthest corner so
 * the objective never lands on the entrance itself.
 */
function objectiveTile(rooms: readonly DungeonRoom[], entrance: Point): Point {
  let best = rooms[0];
  let bestDistance = -1;
  for (const room of rooms) {
    const distance = chebyshev(roomCenter(room), entrance);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = room;
    }
  }
  const center = roomCenter(best);
  if (center.x !== entrance.x || center.y !== entrance.y) return center;
  const corners: Point[] = [
    { x: best.getLeft(), y: best.getTop() },
    { x: best.getRight(), y: best.getTop() },
    { x: best.getLeft(), y: best.getBottom() },
    { x: best.getRight(), y: best.getBottom() },
  ];
  return corners.reduce((farthest, corner) =>
    chebyshev(corner, entrance) > chebyshev(farthest, entrance)
      ? corner
      : farthest,
  );
}

/** Random passable floor tile inside a room, avoiding the given tiles. */
function randomRoomFloor(
  rooms: readonly DungeonRoom[],
  tiles: DungeonTile[][],
  rng: Rng,
  avoid: readonly Point[],
): Point | null {
  for (let attempt = 0; attempt < 24; attempt++) {
    const room = rng.pick(rooms);
    const x = rng.int(room.getLeft(), room.getRight());
    const y = rng.int(room.getTop(), room.getBottom());
    if (tiles[y][x].wall) continue;
    if (tiles[y][x].feature !== "none") continue;
    if (avoid.some((point) => point.x === x && point.y === y)) continue;
    return { x, y };
  }
  return null;
}

/**
 * Generate a deterministic dungeon floor for `seed + dungeonId + floor`.
 * Rooms + corridors come from rot.js `Map.Digger`; the entrance is the first
 * room's center, the objective (stairs down, or the boss marker on the last
 * floor) is the farthest room's center, and one or two chests are scattered on
 * random room floor tiles. Calling this twice with the same inputs always
 * returns an identical layout.
 */
export function generateDungeonLayout(
  seed: number,
  dungeonId: string,
  floor: number,
): DungeonLayout {
  const fseed = floorSeed(seed, dungeonId, floor);
  const isBossFloor = floor >= DUNGEON_FLOORS;
  // Digger reads the global rot.js RNG singleton; isolate and reseed it.
  const saved = RNG.getState();
  try {
    RNG.setSeed(fseed);
    const digger = new RotMap.Digger(DUNGEON_WIDTH, DUNGEON_HEIGHT, {
      roomWidth: [5, 9],
      roomHeight: [4, 7],
      corridorLength: [3, 8],
      dugPercentage: 0.3,
      // Default timeLimit uses wall-clock Date.now(); override so generation
      // terminates only on dugPercentage / wall availability (both deterministic).
      timeLimit: 1e12,
    });
    const tiles: DungeonTile[][] = Array.from({ length: DUNGEON_HEIGHT }, () =>
      Array.from({ length: DUNGEON_WIDTH }, () => ({
        wall: true,
        feature: "none" as DungeonFeature,
      })),
    );
    digger.create((x, y, value) => {
      if (x < 0 || x >= DUNGEON_WIDTH || y < 0 || y >= DUNGEON_HEIGHT) return;
      // value 0 = floor (doors are already floored by Digger), 1 = wall.
      tiles[y][x] = { wall: value !== 0, feature: "none" };
    });
    const rooms = digger.getRooms();
    const entrance = roomCenter(rooms[0]);
    const objective = objectiveTile(rooms, entrance);
    tiles[objective.y][objective.x] = {
      wall: false,
      feature: isBossFloor ? "bossMarker" : "stairsDown",
    };

    // Placements use an independent seeded wrapper (not the global singleton).
    const placement = new Rng(fseed);
    const chestCount = placement.int(1, 2);
    for (let i = 0; i < chestCount; i++) {
      const spot = randomRoomFloor(rooms, tiles, placement, [
        entrance,
        objective,
      ]);
      if (spot) tiles[spot.y][spot.x] = { wall: false, feature: "chest" };
    }

    return { width: DUNGEON_WIDTH, height: DUNGEON_HEIGHT, tiles, entrance };
  } finally {
    RNG.setState(saved);
  }
}

/** A fresh all-unexplored mask sized to `layout`. */
function freshExplored(layout: DungeonLayout): boolean[][] {
  return Array.from({ length: layout.height }, () =>
    Array.from({ length: layout.width }, () => false),
  );
}

/** Reveal every tile within Chebyshev `radius` of `origin`, OR-ed into `explored`. */
export function revealArea(
  explored: readonly (readonly boolean[])[],
  layout: DungeonLayout,
  origin: Point,
  radius: number,
): boolean[][] {
  const next = explored.map((row) => [...row]);
  for (
    let y = Math.max(0, origin.y - radius);
    y <= Math.min(layout.height - 1, origin.y + radius);
    y++
  ) {
    for (
      let x = Math.max(0, origin.x - radius);
      x <= Math.min(layout.width - 1, origin.x + radius);
      x++
    ) {
      next[y][x] = true;
    }
  }
  return next;
}

/** Build the initial `DungeonState` for entering `floor` of a dungeon. */
export function createInitialDungeonState(
  seed: number,
  dungeonId: string,
  floor: number,
): DungeonState {
  const layout = generateDungeonLayout(seed, dungeonId, floor);
  const explored = revealArea(
    freshExplored(layout),
    layout,
    layout.entrance,
    FOV_RADIUS,
  );
  return {
    dungeonId,
    floor,
    layout,
    player: { ...layout.entrance },
    facing: DUNGEON_INITIAL_FACING,
    explored,
    encounter: null,
    reachedBoss: false,
    cleared: false,
  };
}

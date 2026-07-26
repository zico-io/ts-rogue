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

export const DUNGEON_WIDTH = 28;
export const DUNGEON_HEIGHT = 20;

export const DUNGEON_FLOORS = 3;

export const FOV_RADIUS = 3;

export const DUNGEON_ENCOUNTER_CHANCE = 0.12;

export const DUNGEON_INITIAL_FACING: DungeonFacing = "north";

const FACINGS: readonly DungeonFacing[] = ["north", "east", "south", "west"];

const FORWARD_DELTA: Record<DungeonFacing, Point> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export function forwardDelta(facing: DungeonFacing): Point {
  return FORWARD_DELTA[facing];
}

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

export function floorSeed(
  seed: number,
  dungeonId: string,
  floor: number,
): number {
  return Math.max(1, hashSeed([seed, dungeonId, floor]));
}

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

/** Deterministically generates a floor without changing rot.js's global RNG state. */
export function generateDungeonLayout(
  seed: number,
  dungeonId: string,
  floor: number,
): DungeonLayout {
  const fseed = floorSeed(seed, dungeonId, floor);
  const isBossFloor = floor >= DUNGEON_FLOORS;

  const saved = RNG.getState();
  try {
    RNG.setSeed(fseed);
    const digger = new RotMap.Digger(DUNGEON_WIDTH, DUNGEON_HEIGHT, {
      roomWidth: [5, 9],
      roomHeight: [4, 7],
      corridorLength: [3, 8],
      dugPercentage: 0.3,

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

      tiles[y][x] = { wall: value !== 0, feature: "none" };
    });
    const rooms = digger.getRooms();
    const entrance = roomCenter(rooms[0]);
    const objective = objectiveTile(rooms, entrance);
    tiles[objective.y][objective.x] = {
      wall: false,
      feature: isBossFloor ? "bossMarker" : "stairsDown",
    };

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

function freshExplored(layout: DungeonLayout): boolean[][] {
  return Array.from({ length: layout.height }, () =>
    Array.from({ length: layout.width }, () => false),
  );
}

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

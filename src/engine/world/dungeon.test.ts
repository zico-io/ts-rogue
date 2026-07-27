import { describe, expect, it } from "vitest";
import { dungeonDefFor } from "../../data/dungeons";
import {
  createInitialDungeonState,
  DUNGEON_HEIGHT,
  DUNGEON_INITIAL_FACING,
  DUNGEON_WIDTH,
  FOV_RADIUS,
  forwardDelta,
  generateDungeonLayout,
  isDungeonWall,
  rotateFacing,
} from "./dungeon";
import type { DungeonFeature, DungeonLayout, Point } from "./types";

const FLOOR_COUNT = dungeonDefFor("dungeon-0").floorCount;

describe("generateDungeonLayout", () => {
  it("is a pure function of seed + dungeonId + floor: identical inputs -> identical layout", () => {
    for (const floor of [1, 2, 3]) {
      const a = generateDungeonLayout(1234, "dungeon-0", floor);
      const b = generateDungeonLayout(1234, "dungeon-0", floor);
      expect(a).toEqual(b);
    }
  });

  it("produces a different layout for a different floor, dungeon, or seed", () => {
    const base = generateDungeonLayout(1234, "dungeon-0", 1);
    expect(generateDungeonLayout(1234, "dungeon-0", 2)).not.toEqual(base);
    expect(generateDungeonLayout(1234, "dungeon-1", 1)).not.toEqual(base);
    expect(generateDungeonLayout(4321, "dungeon-0", 1)).not.toEqual(base);
  });

  it("fixes the grid size and walls the border so the explored mask always aligns", () => {
    const layout = generateDungeonLayout(42, "dungeon-0", 1);
    expect(layout.width).toBe(DUNGEON_WIDTH);
    expect(layout.height).toBe(DUNGEON_HEIGHT);
    for (let x = 0; x < layout.width; x++) {
      expect(isDungeonWall(layout, { x, y: 0 })).toBe(true);
      expect(isDungeonWall(layout, { x, y: layout.height - 1 })).toBe(true);
    }
    for (let y = 0; y < layout.height; y++) {
      expect(isDungeonWall(layout, { x: 0, y })).toBe(true);
      expect(isDungeonWall(layout, { x: layout.width - 1, y })).toBe(true);
    }
  });

  it("places the entrance on a floor tile, one objective, and at least one chest per floor", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
        const layout = generateDungeonLayout(seed, "dungeon-0", floor);
        expect(isDungeonWall(layout, layout.entrance)).toBe(false);
        const counts = countFeatures(layout);
        if (floor < FLOOR_COUNT) {
          expect(counts.stairsDown).toBe(1);
          expect(counts.bossMarker).toBe(0);
        } else {
          expect(counts.stairsDown).toBe(0);
          expect(counts.bossMarker).toBe(1);
        }
        expect(counts.chest).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("keeps the objective reachable from the entrance on foot (playable slice)", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
        const layout = generateDungeonLayout(seed, "dungeon-0", floor);
        const objective = findObjective(layout);
        expect(objective).toBeDefined();
        if (objective) {
          expect(isReachable(layout, layout.entrance, objective)).toBe(true);
        }
      }
    }
  });

  it("places the boss marker at the def's floorCount, not a fixed global (ROG-89)", () => {
    const shortDef = dungeonDefFor("sunken-crypt");
    const longDef = dungeonDefFor("howling-cave");
    expect(shortDef.floorCount).not.toBe(longDef.floorCount);

    const shortLast = generateDungeonLayout(
      7,
      "sunken-crypt",
      shortDef.floorCount,
    );
    expect(countFeatures(shortLast).bossMarker).toBe(1);

    // The short def's final floor is only a regular floor for the longer def.
    const longAtShortDepth = generateDungeonLayout(
      7,
      "howling-cave",
      shortDef.floorCount,
    );
    expect(countFeatures(longAtShortDepth).bossMarker).toBe(0);
    expect(countFeatures(longAtShortDepth).stairsDown).toBe(1);

    const longLast = generateDungeonLayout(
      7,
      "howling-cave",
      longDef.floorCount,
    );
    expect(countFeatures(longLast).bossMarker).toBe(1);
  });
});

describe("createInitialDungeonState", () => {
  it("starts the party on the entrance, facing north, with the entrance area explored", () => {
    const ds = createInitialDungeonState(1234, "dungeon-0", 1);
    expect(ds.floor).toBe(1);
    expect(ds.dungeonId).toBe("dungeon-0");
    expect(ds.facing).toBe(DUNGEON_INITIAL_FACING);
    expect(ds.player).toEqual(ds.layout.entrance);
    expect(ds.encounter).toBeNull();
    expect(ds.reachedBoss).toBe(false);

    expect(ds.explored[ds.player.y][ds.player.x]).toBe(true);
    const totalSeen = ds.explored.reduce(
      (sum, row) => sum + row.reduce((acc, seen) => acc + (seen ? 1 : 0), 0),
      0,
    );
    expect(totalSeen).toBeGreaterThan(0);
    expect(totalSeen).toBeLessThan(ds.layout.width * ds.layout.height);
    expect(ds.explored[0][0]).toBe(false);
  });

  it("is deterministic: same seed + dungeonId + floor -> identical initial state", () => {
    expect(createInitialDungeonState(2024, "dungeon-0", 1)).toEqual(
      createInitialDungeonState(2024, "dungeon-0", 1),
    );
  });
});

describe("facing helpers", () => {
  it("rotates left and right through the cardinal cycle", () => {
    expect(rotateFacing("north", "left")).toBe("west");
    expect(rotateFacing("west", "left")).toBe("south");
    expect(rotateFacing("south", "left")).toBe("east");
    expect(rotateFacing("east", "left")).toBe("north");
    expect(rotateFacing("north", "right")).toBe("east");
    expect(rotateFacing("east", "right")).toBe("south");
    expect(rotateFacing("south", "right")).toBe("west");
    expect(rotateFacing("west", "right")).toBe("north");
  });

  it("maps facing to a forward step delta", () => {
    expect(forwardDelta("north")).toEqual({ x: 0, y: -1 });
    expect(forwardDelta("east")).toEqual({ x: 1, y: 0 });
    expect(forwardDelta("south")).toEqual({ x: 0, y: 1 });
    expect(forwardDelta("west")).toEqual({ x: -1, y: 0 });
  });

  it("keeps FOV_RADIUS within the smaller dungeon dimension", () => {
    expect(FOV_RADIUS).toBeLessThan(DUNGEON_WIDTH);
    expect(FOV_RADIUS).toBeLessThan(DUNGEON_HEIGHT);
  });
});

function countFeatures(
  layout: DungeonLayout,
): Record<Exclude<DungeonFeature, "none">, number> {
  let stairsDown = 0;
  let bossMarker = 0;
  let chest = 0;
  for (const row of layout.tiles) {
    for (const tile of row) {
      if (tile.feature === "stairsDown") stairsDown++;
      else if (tile.feature === "bossMarker") bossMarker++;
      else if (tile.feature === "chest") chest++;
    }
  }
  return { stairsDown, bossMarker, chest };
}

function findObjective(layout: DungeonLayout): Point | undefined {
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      const feature = layout.tiles[y][x].feature;
      if (feature === "stairsDown" || feature === "bossMarker") return { x, y };
    }
  }
  return undefined;
}

function isReachable(layout: DungeonLayout, from: Point, to: Point): boolean {
  const visited = new Set<string>([`${from.x},${from.y}`]);
  const queue: Point[] = [from];
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length checked above
    const current = queue.shift()!;
    if (current.x === to.x && current.y === to.y) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = `${next.x},${next.y}`;
      if (visited.has(key)) continue;
      if (isDungeonWall(layout, next)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return false;
}

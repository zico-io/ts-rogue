import { describe, expect, it } from "vitest";
import { DUNGEONS } from "../../data/dungeons";
import { footprintCells, LANDMARK_FOOTPRINTS } from "./landmarks";
import {
  biomeDanger,
  generateOverworldMap,
  isPassable,
  tileAt,
} from "./overworld";
import { dungeonWaypointId, storyDungeonForEntrance } from "./waypoints";

function chebyshevDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

describe("generateOverworldMap", () => {
  it("is a pure function of the seed: identical seed -> identical map", () => {
    const a = generateOverworldMap(1234);
    const b = generateOverworldMap(1234);
    expect(a).toEqual(b);
  });

  it("produces a different layout for a different seed", () => {
    const a = generateOverworldMap(1);
    const b = generateOverworldMap(2);
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it("places the village on a passable tile with a walkable neighborhood", () => {
    const map = generateOverworldMap(42);
    expect(tileAt(map, map.village)).toBe("village");
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        const neighbor = { x: map.village.x + dx, y: map.village.y + dy };
        expect(isPassable(tileAt(map, neighbor))).toBe(true);
      }
    }
  });

  it("occupies the village's full 2x2 footprint, anchored at map.village (ENG-7)", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const map = generateOverworldMap(seed);
      const cells = footprintCells(map.village, LANDMARK_FOOTPRINTS.village);
      expect(cells).toHaveLength(4);
      for (const cell of cells) {
        expect(tileAt(map, cell)).toBe("village");
      }
    }
  });

  it("keeps landmark footprints from overlapping each other (ENG-7)", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const map = generateOverworldMap(seed);
      const villageCells = new Set(
        footprintCells(map.village, LANDMARK_FOOTPRINTS.village).map(
          (c) => `${c.x},${c.y}`,
        ),
      );
      for (const entrance of map.dungeonEntrances) {
        expect(villageCells.has(`${entrance.x},${entrance.y}`)).toBe(false);
      }
    }
  });

  it("orders entrances near-to-far so entrance index maps to ascending story dungeon tier (ROG-90)", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const map = generateOverworldMap(seed);
      const distances = map.dungeonEntrances.map((entrance) =>
        chebyshevDistance(map.village, entrance),
      );
      for (let i = 1; i < distances.length; i++) {
        expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
      }

      const tiers = map.dungeonEntrances.map(
        (_, index) => storyDungeonForEntrance(index)?.tier,
      );
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]).toBeGreaterThan(tiers[i - 1] as number);
      }
    }
  });

  it("assigns every entrance a distinct story dungeon id deterministically for a fixed seed (ROG-90)", () => {
    const a = generateOverworldMap(7);
    const b = generateOverworldMap(7);
    expect(a.dungeonEntrances).toEqual(b.dungeonEntrances);

    const ids = a.dungeonEntrances.map((_, index) => dungeonWaypointId(index));
    const expectedIds = [...DUNGEONS]
      .sort((x, y) => x.tier - y.tier)
      .map((dungeon) => dungeon.id);
    expect(ids).toEqual(expectedIds);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("places dungeon entrances only where the village can walk to them", () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const map = generateOverworldMap(seed);
      expect(map.dungeonEntrances.length).toBeGreaterThan(0);
      for (const entrance of map.dungeonEntrances) {
        expect(tileAt(map, entrance)).toBe("dungeonEntrance");
        expect(isReachable(map, map.village, entrance)).toBe(true);
      }
    }
  });
});

describe("isPassable", () => {
  it("blocks mountain and water, allows everything else", () => {
    expect(isPassable("mountain")).toBe(false);
    expect(isPassable("water")).toBe(false);
    expect(isPassable("grass")).toBe(true);
    expect(isPassable("forest")).toBe(true);
    expect(isPassable("village")).toBe(true);
    expect(isPassable("dungeonEntrance")).toBe(true);
  });
});

describe("biomeDanger", () => {
  it("ranks forest above grass and treats waypoints as safe", () => {
    expect(biomeDanger("forest")).toBeGreaterThan(biomeDanger("grass"));
    expect(biomeDanger("village")).toBe(0);
    expect(biomeDanger("dungeonEntrance")).toBe(0);
  });
});

function isReachable(
  map: ReturnType<typeof generateOverworldMap>,
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  const visited = new Set<string>([`${from.x},${from.y}`]);
  const queue = [from];
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
      if (
        next.x < 0 ||
        next.x >= map.width ||
        next.y < 0 ||
        next.y >= map.height
      )
        continue;
      if (!isPassable(tileAt(map, next))) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return false;
}

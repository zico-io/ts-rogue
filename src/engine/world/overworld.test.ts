import { describe, expect, it } from "vitest";
import {
  biomeDanger,
  generateOverworldMap,
  isPassable,
  tileAt,
} from "./overworld.js";

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

/** BFS reachability helper, kept test-local so it doesn't leak into the engine API. */
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

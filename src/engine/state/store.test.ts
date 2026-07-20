import { describe, expect, it } from "vitest";
import { isDungeonWall } from "../world/dungeon";
import { generateOverworldMap, isPassable, tileAt } from "../world/overworld";
import type {
  DungeonFacing,
  DungeonFeature,
  DungeonLayout,
  Point,
} from "../world/types";
import { GameStore, INN_COST_PER_MEMBER, newGame, reduce } from "./store";
import type { GameEvent, GameState } from "./types";

describe("game store", () => {
  it("seeds the log with the seed on new game", () => {
    const state = newGame(1234);
    expect(state.log).toEqual(["Started new game with seed 1234"]);
  });

  it("starts a new game with one hero, starting gold, and empty inventory", () => {
    const state = newGame(1234);
    expect(state.party).toHaveLength(1);
    expect(state.party[0]).toMatchObject({
      id: "hero-1",
      name: "Hero",
      level: 1,
      hp: 20,
      maxHp: 20,
    });
    expect(state.gold).toBe(50);
    expect(state.inventory).toEqual([]);
  });

  it("starts the player on the village tile with an empty encounter meter", () => {
    const state = newGame(1234);
    const map = generateOverworldMap(1234);
    expect(state.worldState).toEqual({
      player: map.village,
      encounterMeter: 0,
    });
  });

  it("changes scene without mutating the previous state", () => {
    const before = newGame(1);
    const after = reduce(before, { type: "ChangeScene", scene: "overworld" });
    expect(after.scene).toBe("overworld");
    expect(before.scene).toBe("village");
    expect(after).not.toBe(before);
  });

  it("appends a log message without mutating the previous state's log", () => {
    const before = newGame(1);
    const after = reduce(before, { type: "Log", message: "hello" });
    expect(after.log).toEqual([...before.log, "hello"]);
    expect(before.log).toEqual(["Started new game with seed 1"]);
    expect(after.log).not.toBe(before.log);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const store = new GameStore(newGame(1));
    const scenes: string[] = [];
    const unsubscribe = store.subscribe((s) => scenes.push(s.scene));
    store.dispatch({ type: "ChangeScene", scene: "dungeon" });
    unsubscribe();
    store.dispatch({ type: "ChangeScene", scene: "battle" });
    expect(store.getState().scene).toBe("battle");
    expect(scenes).toEqual(["dungeon"]);
  });

  describe("InnHeal", () => {
    it("heals the party and deducts gold when affordable", () => {
      const damaged = newGame(1);
      damaged.party[0].hp = 1;
      damaged.party[0].mp = 0;
      const cost = damaged.party.length * INN_COST_PER_MEMBER;
      const after = reduce(damaged, { type: "InnHeal" });
      expect(after.gold).toBe(damaged.gold - cost);
      expect(after.party[0].hp).toBe(after.party[0].maxHp);
      expect(after.party[0].mp).toBe(after.party[0].maxMp);
      expect(after.log.at(-1)).toBe(`Healed the party for ${cost} gold`);
    });

    it("no-ops when gold is insufficient", () => {
      const poor = { ...newGame(1), gold: 0 };
      poor.party[0].hp = 1;
      const after = reduce(poor, { type: "InnHeal" });
      expect(after.gold).toBe(0);
      expect(after.party[0].hp).toBe(1);
      expect(after.log.at(-1)).toBe("Not enough gold to rest at the inn");
    });
  });

  describe("StoreBuy", () => {
    it("deducts gold and adds to inventory on a successful buy", () => {
      const before = newGame(1);
      const after = reduce(before, {
        type: "StoreBuy",
        itemId: "potion",
        quantity: 2,
      });
      expect(after.gold).toBe(before.gold - 20);
      expect(after.inventory).toEqual([{ itemId: "potion", quantity: 2 }]);
      expect(after.log.at(-1)).toBe("Bought 2 Potion for 20 gold");
    });

    it("merges quantities into an existing stack", () => {
      const before = reduce(newGame(1), {
        type: "StoreBuy",
        itemId: "potion",
        quantity: 1,
      });
      const after = reduce(before, {
        type: "StoreBuy",
        itemId: "potion",
        quantity: 3,
      });
      expect(after.inventory).toEqual([{ itemId: "potion", quantity: 4 }]);
    });

    it("no-ops on an unknown item", () => {
      const before = newGame(1);
      const after = reduce(before, {
        type: "StoreBuy",
        itemId: "nonexistent",
        quantity: 1,
      });
      expect(after.gold).toBe(before.gold);
      expect(after.inventory).toEqual([]);
    });

    it("no-ops when gold is insufficient", () => {
      const before = { ...newGame(1), gold: 5 };
      const after = reduce(before, {
        type: "StoreBuy",
        itemId: "potion",
        quantity: 1,
      });
      expect(after.gold).toBe(5);
      expect(after.inventory).toEqual([]);
      expect(after.log.at(-1)).toBe("Not enough gold to buy 1 Potion");
    });
  });

  describe("StoreSell", () => {
    it("removes from inventory and adds gold on a successful sell", () => {
      const owned = reduce(newGame(1), {
        type: "StoreBuy",
        itemId: "potion",
        quantity: 3,
      });
      const after = reduce(owned, {
        type: "StoreSell",
        itemId: "potion",
        quantity: 2,
      });
      expect(after.gold).toBe(owned.gold + 10);
      expect(after.inventory).toEqual([{ itemId: "potion", quantity: 1 }]);
      expect(after.log.at(-1)).toBe("Sold 2 Potion for 10 gold");
    });

    it("drops the stack entry when quantity hits zero", () => {
      const owned = reduce(newGame(1), {
        type: "StoreBuy",
        itemId: "potion",
        quantity: 2,
      });
      const after = reduce(owned, {
        type: "StoreSell",
        itemId: "potion",
        quantity: 2,
      });
      expect(after.inventory).toEqual([]);
    });

    it("no-ops when the item isn't owned in that quantity", () => {
      const before = newGame(1);
      const after = reduce(before, {
        type: "StoreSell",
        itemId: "potion",
        quantity: 1,
      });
      expect(after.gold).toBe(before.gold);
      expect(after.inventory).toEqual([]);
    });
  });

  describe("MoveOverworld", () => {
    it("moves onto a passable tile without mutating the previous state", () => {
      const before = newGame(1);
      const after = reduce(before, { type: "MoveOverworld", dx: 1, dy: 0 });
      expect(after.worldState.player).toEqual({
        x: before.worldState.player.x + 1,
        y: before.worldState.player.y,
      });
      expect(before.worldState.player.x).toBe(3);
      expect(after).not.toBe(before);
    });

    it("blocks movement onto an impassable tile and leaves state untouched", () => {
      const seed = 7;
      const map = generateOverworldMap(seed);
      const blocked = findBlockedStep(map);
      const before = {
        ...newGame(seed),
        scene: "overworld" as const,
        worldState: { player: blocked.from, encounterMeter: 0 },
      };
      const after = reduce(before, {
        type: "MoveOverworld",
        dx: blocked.dx,
        dy: blocked.dy,
      });
      expect(after.worldState.player).toEqual(blocked.from);
      expect(after.rngState).toEqual(before.rngState);
      expect(after.party).toBe(before.party);
      expect(after.log.at(-1)).toBe("The way is blocked");
    });

    it("blocks movement off the edge of the map", () => {
      const before = {
        ...newGame(1),
        worldState: { player: { x: 0, y: 5 }, encounterMeter: 0 },
      };
      const after = reduce(before, { type: "MoveOverworld", dx: -1, dy: 0 });
      expect(after.worldState.player).toEqual({ x: 0, y: 5 });
      expect(after.log.at(-1)).toBe("The way is blocked");
    });

    it("stepping onto the village tile changes scene to village", () => {
      const seed = 1;
      const map = generateOverworldMap(seed);
      const before = {
        ...newGame(seed),
        scene: "overworld" as const,
        worldState: {
          player: { x: map.village.x - 1, y: map.village.y },
          encounterMeter: 0,
        },
      };
      const after = reduce(before, { type: "MoveOverworld", dx: 1, dy: 0 });
      expect(after.scene).toBe("village");
      expect(after.worldState.player).toEqual(map.village);
      expect(after.log.at(-1)).toBe("You return to the village");
    });

    it("stepping onto a dungeon entrance changes scene to dungeon", () => {
      const seed = 1;
      const map = generateOverworldMap(seed);
      const entrance = map.dungeonEntrances[0];
      const approach = findPassableNeighbor(map, entrance);
      const before = {
        ...newGame(seed),
        scene: "overworld" as const,
        worldState: { player: approach.from, encounterMeter: 0 },
      };
      const after = reduce(before, {
        type: "MoveOverworld",
        dx: approach.dx,
        dy: approach.dy,
      });
      expect(after.scene).toBe("dungeon");
      expect(after.worldState.player).toEqual(entrance);
      expect(after.log.at(-1)).toBe("You descend into the dungeon");
      expect(after.dungeonState).not.toBeNull();
      expect(after.dungeonState?.floor).toBe(1);
      expect(after.dungeonState?.dungeonId).toBe("dungeon-0");
      expect(after.dungeonState?.player).toEqual(
        after.dungeonState?.layout.entrance,
      );
    });

    it("accumulates encounter danger on wild tiles below the threshold", () => {
      const before = {
        ...newGame(1),
        scene: "overworld" as const,
        worldState: { player: { x: 1, y: 10 }, encounterMeter: 0 },
      };
      const after = reduce(before, { type: "MoveOverworld", dx: 1, dy: 0 });
      expect(after.scene).toBe("overworld");
      expect(after.worldState.encounterMeter).toBeGreaterThan(0);
      expect(after.worldState.encounterMeter).toBeLessThan(100);
      expect(after.rngState).not.toEqual(before.rngState);
    });

    it("triggers a battle once the encounter meter crosses the threshold, then resets it", () => {
      const before = {
        ...newGame(1),
        worldState: { player: { x: 1, y: 10 }, encounterMeter: 99 },
      };
      const after = reduce(before, { type: "MoveOverworld", dx: 1, dy: 0 });
      expect(after.scene).toBe("battle");
      expect(after.worldState.encounterMeter).toBe(0);
      expect(after.log.at(-1)).toBe("A monster ambushes the party!");
    });

    it("is deterministic: the same seed and move sequence produce identical states", () => {
      const moves: ReadonlyArray<{ dx: -1 | 0 | 1; dy: -1 | 0 | 1 }> = [
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: -1 },
      ];
      const runOnce = () =>
        moves.reduce<ReturnType<typeof newGame>>(
          (state, move) =>
            reduce(state, { type: "MoveOverworld", dx: move.dx, dy: move.dy }),
          newGame(2024),
        );
      expect(runOnce()).toEqual(runOnce());
    });
  });
});

/** Finds a passable tile adjacent to an impassable one, for blocked-move tests. */
function findBlockedStep(map: ReturnType<typeof generateOverworldMap>): {
  from: { x: number; y: number };
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
} {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (isPassable(tileAt(map, { x, y }))) continue;
      const neighbors: Array<{ dx: -1 | 0 | 1; dy: -1 | 0 | 1 }> = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ];
      for (const { dx, dy } of neighbors) {
        const from = { x: x - dx, y: y - dy };
        if (
          from.x < 0 ||
          from.x >= map.width ||
          from.y < 0 ||
          from.y >= map.height
        )
          continue;
        if (isPassable(tileAt(map, from))) return { from, dx, dy };
      }
    }
  }
  throw new Error("no blocked step found for this map");
}

/** Finds a passable tile adjacent to `target`, for entrance/village approach tests. */
function findPassableNeighbor(
  map: ReturnType<typeof generateOverworldMap>,
  target: { x: number; y: number },
): { from: { x: number; y: number }; dx: -1 | 0 | 1; dy: -1 | 0 | 1 } {
  const neighbors: Array<{ dx: -1 | 0 | 1; dy: -1 | 0 | 1 }> = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (const { dx, dy } of neighbors) {
    const from = { x: target.x - dx, y: target.y - dy };
    if (from.x < 0 || from.x >= map.width || from.y < 0 || from.y >= map.height)
      continue;
    if (isPassable(tileAt(map, from))) return { from, dx, dy };
  }
  throw new Error("no passable approach found for this target");
}

describe("Dungeon", () => {
  it("entering a dungeon entrance creates floor 1 dungeonState and switches scene", () => {
    const state = enterDungeon(1);
    expect(state.scene).toBe("dungeon");
    expect(state.dungeonState?.floor).toBe(1);
    expect(state.dungeonState?.dungeonId).toBe("dungeon-0");
    expect(state.dungeonState?.player).toEqual(
      state.dungeonState?.layout.entrance,
    );
    expect(state.log.at(-1)).toBe("You descend into the dungeon");
  });

  it("TurnDungeon rotates the facing without mutating the previous state or logging", () => {
    const before = enterDungeon(1);
    const after = reduce(before, { type: "TurnDungeon", direction: "right" });
    expect(after.dungeonState?.facing).toBe("east");
    expect(before.dungeonState?.facing).toBe("north");
    expect(after).not.toBe(before);
    expect(after.log).toBe(before.log);
  });

  it("StepDungeon forward moves onto the floor ahead and reveals the new tile", () => {
    const before = enterDungeon(1234);
    const after = reduce(before, { type: "StepDungeon", direction: "forward" });
    expect(after.dungeonState?.player).toEqual({
      x: before.dungeonState?.player.x,
      y: (before.dungeonState?.player.y ?? 0) - 1,
    });
    expect(
      after.dungeonState?.explored[after.dungeonState.player.y][
        after.dungeonState.player.x
      ],
    ).toBe(true);
  });

  it("blocks a step into a wall without consuming RNG", () => {
    let state = enterDungeon(7);
    let blocked: { before: GameState; after: GameState } | null = null;
    for (let i = 0; i < 40 && !blocked; i++) {
      const before = state;
      const after = reduce(state, {
        type: "StepDungeon",
        direction: "forward",
      });
      if (
        after.dungeonState?.player.x === before.dungeonState?.player.x &&
        after.dungeonState?.player.y === before.dungeonState?.player.y
      ) {
        blocked = { before, after };
      } else {
        state =
          after.scene === "battle"
            ? reduce(after, { type: "BattleFlee" })
            : after;
      }
    }
    expect(blocked).not.toBeNull();
    expect(blocked?.after.rngState).toEqual(blocked?.before.rngState);
    expect(blocked?.after.log.at(-1)).toBe("The way is blocked");
  });

  it("flags a wandering encounter on a plain-floor step (stub transition to battle)", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const after = reduce(enterDungeon(seed), {
        type: "StepDungeon",
        direction: "forward",
      });
      if (
        after.scene === "battle" &&
        after.dungeonState?.encounter?.kind === "wandering"
      ) {
        expect(after.log.at(-1)).toBe("An enemy appears!");
        const fled = reduce(after, { type: "BattleFlee" });
        expect(fled.scene).toBe("dungeon");
        expect(fled.dungeonState?.encounter).toBeNull();
        expect(fled.log.at(-1)).toBe("You slip away into the shadows");
        return;
      }
    }
    throw new Error("no wandering encounter triggered within the seed range");
  });

  it("is deterministic: the same seed and dungeon move sequence produce identical states", () => {
    const moves: GameEvent[] = [
      { type: "TurnDungeon", direction: "right" },
      { type: "StepDungeon", direction: "forward" },
      { type: "StepDungeon", direction: "forward" },
      { type: "TurnDungeon", direction: "left" },
      { type: "StepDungeon", direction: "forward" },
      { type: "StepDungeon", direction: "back" },
      { type: "TurnDungeon", direction: "right" },
      { type: "StepDungeon", direction: "forward" },
      { type: "StepDungeon", direction: "forward" },
      { type: "StepDungeon", direction: "forward" },
    ];
    const runOnce = () => moves.reduce(reduce, enterDungeon(2024));
    expect(runOnce()).toEqual(runOnce());
  });

  it("end-to-end: descend, open a chest, and reach the boss room", () => {
    let state = enterDungeon(1234);
    expect(state.dungeonState?.floor).toBe(1);

    const goldBefore = state.gold;
    const inventoryBefore = state.inventory.length;

    const chest1 = findDungeonTile(state, "chest");
    expect(chest1).toBeDefined();
    state = walkTo(state, chest1 ?? { x: 0, y: 0 });
    state = reduce(state, { type: "OpenChest" });
    expect(state.gold).toBeGreaterThan(goldBefore);
    expect(state.inventory.length).toBeGreaterThan(inventoryBefore);
    expect(state.log.at(-1)).toMatch(/You open the chest and find/);

    const stairs1 = findDungeonTile(state, "stairsDown");
    expect(stairs1).toBeDefined();
    state = walkTo(state, stairs1 ?? { x: 0, y: 0 });
    state = reduce(state, { type: "DescendStairs" });
    expect(state.dungeonState?.floor).toBe(2);

    const stairs2 = findDungeonTile(state, "stairsDown");
    expect(stairs2).toBeDefined();
    state = walkTo(state, stairs2 ?? { x: 0, y: 0 });
    state = reduce(state, { type: "DescendStairs" });
    expect(state.dungeonState?.floor).toBe(3);

    const boss = findDungeonTile(state, "bossMarker");
    expect(boss).toBeDefined();
    state = walkTo(state, boss ?? { x: 0, y: 0 });
    expect(state.dungeonState?.reachedBoss).toBe(true);
    expect(state.scene).toBe("battle");
    expect(state.dungeonState?.encounter?.kind).toBe("boss");
    expect(state.log.at(-1)).toBe(
      "You have reached the boss room! A guardian stirs",
    );
  });
});

/** Enter floor 1 of dungeon 0 from the overworld, via the real MoveOverworld path. */
function enterDungeon(seed: number): GameState {
  const map = generateOverworldMap(seed);
  const entrance = map.dungeonEntrances[0];
  const approach = findPassableNeighbor(map, entrance);
  return reduce(
    {
      ...newGame(seed),
      scene: "overworld" as const,
      worldState: { player: approach.from, encounterMeter: 0 },
    },
    { type: "MoveOverworld", dx: approach.dx, dy: approach.dy },
  );
}

/** First tile on the current dungeon floor carrying `feature`, or undefined. */
function findDungeonTile(
  state: GameState,
  feature: DungeonFeature,
): Point | undefined {
  const layout = state.dungeonState?.layout;
  if (!layout) return undefined;
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      if (layout.tiles[y][x].feature === feature) return { x, y };
    }
  }
  return undefined;
}

/** Facing needed to step from `from` onto an orthogonally adjacent `to`. */
function facingFor(from: Point, to: Point): DungeonFacing {
  if (to.x - from.x === 1) return "east";
  if (to.x - from.x === -1) return "west";
  if (to.y - from.y === 1) return "south";
  return "north";
}

/** Rotate (right turns only) until the party faces `facing`. */
function turnTo(state: GameState, facing: DungeonFacing): GameState {
  let s = state;
  let guard = 0;
  while (s.dungeonState?.facing !== facing && guard++ < 4) {
    s = reduce(s, { type: "TurnDungeon", direction: "right" });
  }
  return s;
}

/** Shortest path of floor tiles from `from` to `to` (inclusive), or null. */
function bfsPath(
  layout: DungeonLayout,
  from: Point,
  to: Point,
): Point[] | null {
  const cameFrom = new Map<string, string>();
  const visited = new Set<string>([`${from.x},${from.y}`]);
  const queue: Point[] = [from];
  while (queue.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length checked above
    const current = queue.shift()!;
    if (current.x === to.x && current.y === to.y) {
      const path: Point[] = [current];
      let key = `${current.x},${current.y}`;
      while (cameFrom.has(key)) {
        const prevKey = cameFrom.get(key);
        if (!prevKey) break;
        const [px, py] = prevKey.split(",").map(Number);
        path.unshift({ x: px, y: py });
        key = prevKey;
      }
      return path;
    }
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
      cameFrom.set(key, `${current.x},${current.y}`);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Drive the real reducer to walk the party to `target`, fleeing any wandering
 * encounters triggered en route. Returns when the party stands on `target`.
 */
function walkTo(state: GameState, target: Point): GameState {
  let s = state;
  for (let i = 0; i < 400; i++) {
    const ds = s.dungeonState;
    if (!ds) break;
    if (ds.player.x === target.x && ds.player.y === target.y) return s;
    if (s.scene === "battle") {
      s = reduce(s, { type: "BattleFlee" });
      continue;
    }
    const path = bfsPath(ds.layout, ds.player, target);
    if (!path || path.length < 2) break;
    const next = path[1];
    s = turnTo(s, facingFor(ds.player, next));
    s = reduce(s, { type: "StepDungeon", direction: "forward" });
  }
  return s;
}

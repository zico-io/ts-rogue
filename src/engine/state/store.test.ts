import { describe, expect, it } from "vitest";
import { deserialize, serialize } from "../../persistence/save";
import { atkFrom, startBattle } from "../combat/resolution";
import type { PartyMember } from "../entities/party";
import { FIELD_BACKPACK_CAP } from "../loot/inventory";
import { describeItem, itemSellPrice } from "../loot/items";
import { EMPTY_LOOT_FILTER, type LootFilterRules } from "../loot/lootFilter";
import type { ItemInstance } from "../loot/types";
import { Rng } from "../rng/rng";
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
    expect(state.log).toEqual([
      { text: "Started new game with seed 1234", kind: "quest" },
    ]);
  });

  it("starts a new game with one hero, starting gold, and empty inventory", () => {
    const state = newGame(1234);
    expect(state.party).toHaveLength(1);
    expect(state.party[0]).toMatchObject({
      id: "hero-1",
      name: "Hero",
      classId: "warrior",
      level: 1,
      hp: 24,
      maxHp: 24,
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

  it("seeds activatedWaypoints with just the village on a new run (ENG-1)", () => {
    const state = newGame(1234);
    expect(state.activatedWaypoints).toEqual(["village"]);
  });

  it("defaults flags to permadeath=false and gameOver=false", () => {
    const state = newGame(1234);
    expect(state.flags).toEqual({ permadeath: false, gameOver: false });
  });

  it("accepts a permadeath option at new-game time", () => {
    const state = newGame(1234, { permadeath: true });
    expect(state.flags.permadeath).toBe(true);
    expect(state.flags.gameOver).toBe(false);
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
    expect(after.log).toEqual([
      ...before.log,
      { text: "hello", kind: "system" },
    ]);
    expect(before.log).toEqual([
      { text: "Started new game with seed 1", kind: "quest" },
    ]);
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
      expect(after.log.at(-1)?.text).toBe(`Healed the party for ${cost} gold`);
    });

    it("no-ops when gold is insufficient", () => {
      const poor = { ...newGame(1), gold: 0 };
      poor.party[0].hp = 1;
      const after = reduce(poor, { type: "InnHeal" });
      expect(after.gold).toBe(0);
      expect(after.party[0].hp).toBe(1);
      expect(after.log.at(-1)?.text).toBe("Not enough gold to rest at the inn");
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
      expect(after.log.at(-1)?.text).toBe("Bought 2 Potion for 20 gold");
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
      expect(after.log.at(-1)?.text).toBe("Not enough gold to buy 1 Potion");
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
      expect(after.log.at(-1)?.text).toBe("Sold 2 Potion for 10 gold");
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
      expect(after.log.at(-1)?.text).toBe("The way is blocked");
    });

    it("blocks movement off the edge of the map", () => {
      const before = {
        ...newGame(1),
        worldState: { player: { x: 0, y: 5 }, encounterMeter: 0 },
      };
      const after = reduce(before, { type: "MoveOverworld", dx: -1, dy: 0 });
      expect(after.worldState.player).toEqual({ x: 0, y: 5 });
      expect(after.log.at(-1)?.text).toBe("The way is blocked");
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
      expect(after.log.at(-1)?.text).toBe("You return to the village");
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
      expect(after.log.at(-1)?.text).toBe("You descend into the dungeon");
      expect(after.dungeonState).not.toBeNull();
      expect(after.dungeonState?.floor).toBe(1);
      expect(after.dungeonState?.dungeonId).toBe("dungeon-0");
      expect(after.dungeonState?.player).toEqual(
        after.dungeonState?.layout.entrance,
      );
      expect(after.activatedWaypoints).toEqual(["village", "dungeon-0"]);
    });

    it("re-entering an already-activated dungeon entrance does not duplicate its waypoint", () => {
      const seed = 1;
      const map = generateOverworldMap(seed);
      const entrance = map.dungeonEntrances[0];
      const approach = findPassableNeighbor(map, entrance);
      const enter = {
        type: "MoveOverworld" as const,
        dx: approach.dx,
        dy: approach.dy,
      };
      const before = {
        ...newGame(seed),
        scene: "overworld" as const,
        worldState: { player: approach.from, encounterMeter: 0 },
      };
      const first = reduce(before, enter);
      const exited = reduce(first, { type: "ExitDungeon" });
      const second = reduce(
        {
          ...exited,
          worldState: { ...exited.worldState, player: approach.from },
        },
        enter,
      );
      expect(second.activatedWaypoints).toEqual(["village", "dungeon-0"]);
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
      expect(after.battleState).not.toBeNull();
      expect(after.worldState.encounterMeter).toBe(0);
      expect(after.log.at(-1)?.text).toBe("A monster ambushes the party!");
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
    expect(state.dungeonState?.cleared).toBe(false);
    expect(state.log.at(-1)?.text).toBe("You descend into the dungeon");
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
    let state = withToughHero(enterDungeon(7));
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
        state = after.scene === "battle" ? fightToResolution(after) : after;
      }
    }
    expect(blocked).not.toBeNull();
    expect(blocked?.after.rngState).toEqual(blocked?.before.rngState);
    expect(blocked?.after.log.at(-1)?.text).toBe("The way is blocked");
  });

  it("starts a real battle on a wandering encounter and returns to the dungeon on victory", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const after = reduce(withToughHero(enterDungeon(seed)), {
        type: "StepDungeon",
        direction: "forward",
      });
      if (
        after.scene === "battle" &&
        after.dungeonState?.encounter?.kind === "wandering" &&
        after.battleState
      ) {
        expect(after.log.at(-1)?.text).toBe("An enemy appears!");
        const won = fightToResolution(after);
        expect(won.scene).toBe("dungeon");
        expect(won.battleState).toBeNull();
        expect(won.dungeonState?.encounter).toBeNull();
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
    let state = withToughHero(enterDungeon(1234));
    expect(state.dungeonState?.floor).toBe(1);

    const goldBefore = state.gold;
    const inventoryBefore = state.inventory.length;

    const chest1 = findDungeonTile(state, "chest");
    expect(chest1).toBeDefined();
    state = walkTo(state, chest1 ?? { x: 0, y: 0 });
    state = reduce(state, { type: "OpenChest" });
    expect(state.gold).toBeGreaterThan(goldBefore);
    expect(state.inventory.length).toBeGreaterThan(inventoryBefore);
    expect(state.log.at(-1)?.text).toMatch(/You open the chest and find/);

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
    expect(state.log.at(-1)?.text).toBe(
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
/** Overpower the hero so traversal tests can fight through wandering encounters. */
function withToughHero(state: GameState): GameState {
  const tough: PartyMember = {
    ...state.party[0],
    hp: 999,
    maxHp: 999,
    mp: 999,
    maxMp: 999,
    stats: { str: 50, agi: 50, vit: 50, int: 50 },
  };
  return { ...state, party: [tough] };
}

/** Drive an active battle to resolution by attacking the first living enemy. */
function fightToResolution(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 200 && s.scene === "battle"; i++) {
    const bs = s.battleState;
    if (!bs) break;
    const target = bs.enemies.find((enemy) => enemy.hp > 0);
    if (!target) break;
    s = reduce(s, { type: "BattleAttack", targetId: target.id });
  }
  return s;
}

function walkTo(state: GameState, target: Point): GameState {
  let s = state;
  for (let i = 0; i < 400; i++) {
    const ds = s.dungeonState;
    if (!ds) break;
    if (ds.player.x === target.x && ds.player.y === target.y) return s;
    if (s.scene === "battle") {
      s = fightToResolution(s);
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

describe("RecruitMember (ROG-20 dev/manual party growth)", () => {
  it("appends a new member built from the class, up to 4 total", () => {
    let state = newGame(1);
    expect(state.party).toHaveLength(1);

    state = reduce(state, { type: "RecruitMember", classId: "rogue" });
    expect(state.party).toHaveLength(2);
    expect(state.party[1]).toMatchObject({ id: "member-2", classId: "rogue" });
    expect(state.log.at(-1)?.text).toMatch(/^Recruited .* the rogue!$/);

    state = reduce(state, { type: "RecruitMember", classId: "wizard" });
    state = reduce(state, { type: "RecruitMember", classId: "warrior" });
    expect(state.party).toHaveLength(4);
  });

  it("logs and no-ops once the party is full", () => {
    let state = newGame(1);
    for (const classId of ["rogue", "wizard", "warrior"]) {
      state = reduce(state, { type: "RecruitMember", classId });
    }
    expect(state.party).toHaveLength(4);
    const after = reduce(state, { type: "RecruitMember", classId: "rogue" });
    expect(after.party).toHaveLength(4);
    expect(after.log.at(-1)?.text).toBe("The party is already full");
  });
});

describe("Phase 5 loot, equip, and sell", () => {
  function makeItem(overrides: Partial<ItemInstance> = {}): ItemInstance {
    return {
      instanceId: "itm-test",
      baseId: "war-blade",
      rarity: "rare",
      ilvl: 10,
      prefixes: [],
      suffixes: [],
      implicit: null,
      ...overrides,
    };
  }

  function equipmentSlots(): Array<
    "weapon" | "armor" | "accessory1" | "accessory2"
  > {
    return ["weapon", "armor", "accessory1", "accessory2"];
  }

  describe("EquipItem", () => {
    it("moves a backpack weapon into its slot and raises effective ATK", () => {
      const before = {
        ...newGame(1),
        items: [makeItem({ instanceId: "itm-1", baseId: "war-blade" })],
      };
      const atkBefore = atkFrom(before.party[0]);
      const after = reduce(before, {
        type: "EquipItem",
        instanceId: "itm-1",
        memberId: before.party[0].id,
      });
      expect(after.items).toHaveLength(0);
      expect(after.party[0].equipment.weapon?.instanceId).toBe("itm-1");
      expect(atkFrom(after.party[0])).toBeGreaterThan(atkBefore);
      expect(after.log.some((m) => m.text.startsWith("Equipped"))).toBe(true);
    });

    it("swaps the previously equipped item back to the backpack", () => {
      const base = newGame(1);
      const equipped = makeItem({ instanceId: "itm-old", baseId: "war-blade" });
      const before = {
        ...base,
        party: [
          {
            ...base.party[0],
            equipment: { ...base.party[0].equipment, weapon: equipped },
          },
        ],
        items: [makeItem({ instanceId: "itm-new", baseId: "war-blade" })],
      };
      const after = reduce(before, {
        type: "EquipItem",
        instanceId: "itm-new",
        memberId: before.party[0].id,
      });
      expect(after.party[0].equipment.weapon?.instanceId).toBe("itm-new");
      expect(after.items.map((i) => i.instanceId)).toContain("itm-old");
    });

    it("no-ops on an unknown instance id", () => {
      const before = newGame(1);
      const after = reduce(before, {
        type: "EquipItem",
        instanceId: "nope",
        memberId: before.party[0].id,
      });
      expect(after.party[0].equipment.weapon).toBeNull();
      expect(after.log.at(-1)?.text).toBe("There is nothing to equip");
    });
  });

  describe("UnequipItem", () => {
    it("moves an equipped item back to the backpack", () => {
      const base = newGame(1);
      const item = makeItem({ instanceId: "itm-w", baseId: "war-blade" });
      const before = {
        ...base,
        party: [
          {
            ...base.party[0],
            equipment: { ...base.party[0].equipment, weapon: item },
          },
        ],
      };
      const after = reduce(before, {
        type: "UnequipItem",
        slot: "weapon",
        memberId: before.party[0].id,
      });
      expect(after.party[0].equipment.weapon).toBeNull();
      expect(after.items.map((i) => i.instanceId)).toContain("itm-w");
    });

    it("no-ops on an empty slot", () => {
      const after = reduce(newGame(1), {
        type: "UnequipItem",
        slot: "weapon",
        memberId: newGame(1).party[0].id,
      });
      expect(after.log.at(-1)?.text).toBe("Nothing is equipped there");
    });

    it("no-ops on an unknown memberId", () => {
      const after = reduce(newGame(1), {
        type: "UnequipItem",
        slot: "weapon",
        memberId: "nope",
      });
      expect(after.log.at(-1)?.text).toBe("Nothing is equipped there");
    });
  });

  describe("EquipItem/UnequipItem target a specific memberId (ROG-20)", () => {
    it("equips into the second party member's slot, leaving the first untouched", () => {
      const recruited = reduce(newGame(1), {
        type: "RecruitMember",
        classId: "rogue",
      });
      const second = recruited.party[1];
      const before = {
        ...recruited,
        items: [makeItem({ instanceId: "itm-2", baseId: "war-blade" })],
      };
      const after = reduce(before, {
        type: "EquipItem",
        instanceId: "itm-2",
        memberId: second.id,
      });
      expect(after.party[0].equipment.weapon).toBeNull();
      expect(after.party[1].equipment.weapon?.instanceId).toBe("itm-2");

      const unequipped = reduce(after, {
        type: "UnequipItem",
        slot: "weapon",
        memberId: second.id,
      });
      expect(unequipped.party[1].equipment.weapon).toBeNull();
      expect(unequipped.items.map((i) => i.instanceId)).toContain("itm-2");
    });
  });

  describe("SellItem", () => {
    it("removes the item and adds the sell price to gold", () => {
      const item = makeItem({
        instanceId: "itm-s",
        baseId: "war-blade",
        rarity: "unique",
      });
      const before = { ...newGame(1), items: [item] };
      const goldBefore = before.gold;
      const after = reduce(before, { type: "SellItem", instanceId: "itm-s" });
      expect(after.items).toHaveLength(0);
      expect(after.gold).toBe(goldBefore + itemSellPrice(item));
      expect(after.log.at(-1)?.text).toBe(
        `Sold ${describeItem(item)} for ${itemSellPrice(item)} gold.`,
      );
    });

    it("no-ops on an unknown instance id", () => {
      const before = newGame(1);
      const after = reduce(before, { type: "SellItem", instanceId: "nope" });
      expect(after.gold).toBe(before.gold);
      expect(after.log.at(-1)?.text).toBe("There is nothing to sell");
    });
  });

  describe("UseFieldItem (ENG-4 field consumable use)", () => {
    it("heals the target member, caps at maxHp, and consumes one from the stack", () => {
      const base = newGame(1);
      const before = {
        ...base,
        party: [{ ...base.party[0], hp: base.party[0].maxHp - 10 }],
        inventory: [{ itemId: "potion", quantity: 2 }],
      };
      const after = reduce(before, {
        type: "UseFieldItem",
        itemId: "potion",
        memberId: before.party[0].id,
      });
      expect(after.party[0].hp).toBe(before.party[0].maxHp);
      expect(after.inventory).toEqual([{ itemId: "potion", quantity: 1 }]);
      expect(after.log.at(-1)?.text).toBe(
        `${before.party[0].name} uses Potion and recovers 10 HP.`,
      );
    });

    it("drops the stack entirely once the last unit is consumed", () => {
      const base = newGame(1);
      const before = {
        ...base,
        party: [{ ...base.party[0], hp: base.party[0].maxHp - 5 }],
        inventory: [{ itemId: "potion", quantity: 1 }],
      };
      const after = reduce(before, {
        type: "UseFieldItem",
        itemId: "potion",
        memberId: before.party[0].id,
      });
      expect(after.inventory).toEqual([]);
    });

    it("no-ops when the item is not owned", () => {
      const before = newGame(1);
      const after = reduce(before, {
        type: "UseFieldItem",
        itemId: "potion",
        memberId: before.party[0].id,
      });
      expect(after.party[0].hp).toBe(before.party[0].hp);
      expect(after.log.at(-1)?.text).toBe("That item cannot be used here");
    });

    it("no-ops on a non-heal consumable (e.g. antidote)", () => {
      const base = newGame(1);
      const before = {
        ...base,
        inventory: [{ itemId: "antidote", quantity: 1 }],
      };
      const after = reduce(before, {
        type: "UseFieldItem",
        itemId: "antidote",
        memberId: before.party[0].id,
      });
      expect(after.inventory).toEqual(before.inventory);
      expect(after.log.at(-1)?.text).toBe("That item cannot be used here");
    });

    it("no-ops on an unknown memberId", () => {
      const base = newGame(1);
      const before = {
        ...base,
        inventory: [{ itemId: "potion", quantity: 1 }],
      };
      const after = reduce(before, {
        type: "UseFieldItem",
        itemId: "potion",
        memberId: "nope",
      });
      expect(after.inventory).toEqual(before.inventory);
      expect(after.log.at(-1)?.text).toBe("No such party member");
    });

    it("no-ops on an already-full-health member", () => {
      const base = newGame(1);
      const before = {
        ...base,
        inventory: [{ itemId: "potion", quantity: 1 }],
      };
      const after = reduce(before, {
        type: "UseFieldItem",
        itemId: "potion",
        memberId: before.party[0].id,
      });
      expect(after.inventory).toEqual(before.inventory);
      expect(after.log.at(-1)?.text).toBe(
        `${before.party[0].name} is already at full health`,
      );
    });

    it("no-ops on a downed member", () => {
      const base = newGame(1);
      const before = {
        ...base,
        party: [{ ...base.party[0], hp: 0 }],
        inventory: [{ itemId: "potion", quantity: 1 }],
      };
      const after = reduce(before, {
        type: "UseFieldItem",
        itemId: "potion",
        memberId: before.party[0].id,
      });
      expect(after.inventory).toEqual(before.inventory);
      expect(after.log.at(-1)?.text).toBe(
        `${before.party[0].name} is down and cannot be healed by items`,
      );
    });

    it("is rejected while in battle - the battle item command is unchanged", () => {
      const base = newGame(1);
      const before = {
        ...base,
        scene: "battle" as const,
        party: [{ ...base.party[0], hp: base.party[0].maxHp - 10 }],
        inventory: [{ itemId: "potion", quantity: 1 }],
      };
      const after = reduce(before, {
        type: "UseFieldItem",
        itemId: "potion",
        memberId: before.party[0].id,
      });
      expect(after.party[0].hp).toBe(before.party[0].hp);
      expect(after.inventory).toEqual(before.inventory);
      expect(after.log.at(-1)?.text).toBe(
        "Use battle items from the battle menu",
      );
    });
  });

  describe("OpenChest (Phase 5 generated loot)", () => {
    it("adds a generated item to state.items and advances nextItemId", () => {
      let state = withToughHero(enterDungeon(1234));
      const chest = findDungeonTile(state, "chest");
      expect(chest).toBeDefined();
      state = walkTo(state, chest ?? { x: 0, y: 0 });
      const nextBefore = state.nextItemId;
      const itemsBefore = state.items.length;
      state = reduce(state, { type: "OpenChest" });
      expect(state.items.length).toBe(itemsBefore + 1);
      expect(state.nextItemId).toBe(nextBefore + 1);
      expect(state.log.at(-1)?.text).toMatch(/You open the chest and find/);
    });
  });

  describe("DepositItem/WithdrawItem (ENG-5 village stash)", () => {
    it("moves an item from the field backpack to the stash and back", () => {
      const item = makeItem({ instanceId: "itm-d", baseId: "war-blade" });
      const before = { ...newGame(1), items: [item] };
      const deposited = reduce(before, {
        type: "DepositItem",
        instanceId: "itm-d",
      });
      expect(deposited.items).toHaveLength(0);
      expect(deposited.stash.map((i) => i.instanceId)).toEqual(["itm-d"]);
      expect(deposited.log.at(-1)?.text).toMatch(/^Stashed/);

      const withdrawn = reduce(deposited, {
        type: "WithdrawItem",
        instanceId: "itm-d",
      });
      expect(withdrawn.stash).toHaveLength(0);
      expect(withdrawn.items.map((i) => i.instanceId)).toEqual(["itm-d"]);
      expect(withdrawn.log.at(-1)?.text).toMatch(/^Withdrew/);
    });

    it("no-ops depositing an unknown instance id", () => {
      const before = newGame(1);
      const after = reduce(before, {
        type: "DepositItem",
        instanceId: "nope",
      });
      expect(after.items).toEqual(before.items);
      expect(after.stash).toEqual(before.stash);
      expect(after.log.at(-1)?.text).toBe("There is nothing to stash");
    });

    it("no-ops withdrawing an unknown instance id", () => {
      const before = newGame(1);
      const after = reduce(before, {
        type: "WithdrawItem",
        instanceId: "nope",
      });
      expect(after.log.at(-1)?.text).toBe("There is nothing to withdraw");
    });

    it("refuses to withdraw once the field backpack is at cap, leaving the item in the stash", () => {
      const item = makeItem({ instanceId: "itm-w" });
      const filler = Array.from({ length: FIELD_BACKPACK_CAP }, (_, i) =>
        makeItem({ instanceId: `f-${i}` }),
      );
      const before = { ...newGame(1), items: filler, stash: [item] };
      const after = reduce(before, {
        type: "WithdrawItem",
        instanceId: "itm-w",
      });
      expect(after.items).toHaveLength(FIELD_BACKPACK_CAP);
      expect(after.stash.map((i) => i.instanceId)).toEqual(["itm-w"]);
      expect(after.log.at(-1)?.text).toMatch(/Backpack is full/);
    });

    it("stashed items never count against the field backpack cap", () => {
      const stashed = Array.from({ length: 50 }, (_, i) =>
        makeItem({ instanceId: `s-${i}` }),
      );
      const state = { ...newGame(1), stash: stashed };
      expect(state.items).toHaveLength(0);
      expect(state.stash).toHaveLength(50);
    });
  });

  describe("ResolveLootTriage (ENG-5 full-backpack triage)", () => {
    function fullBackpackState(drops: ItemInstance[]): GameState {
      const filler = Array.from({ length: FIELD_BACKPACK_CAP }, (_, i) =>
        makeItem({ instanceId: `f-${i}` }),
      );
      return {
        ...newGame(1),
        items: filler,
        pendingLootTriage: { drops },
      };
    }

    it("dismantleDrop sells the queued drop for gold and leaves items untouched", () => {
      const drop = makeItem({
        instanceId: "drop-1",
        baseId: "war-blade",
        rarity: "rare",
      });
      const before = fullBackpackState([drop]);
      const after = reduce(before, {
        type: "ResolveLootTriage",
        action: "dismantleDrop",
      });
      expect(after.items.map((i) => i.instanceId)).toEqual(
        before.items.map((i) => i.instanceId),
      );
      expect(after.gold).toBe(before.gold + itemSellPrice(drop));
      expect(after.pendingLootTriage).toBeNull();
      expect(after.log.at(-1)?.text).toBe(
        `Dismantled ${describeItem(drop)} for ${itemSellPrice(drop)} gold.`,
      );
    });

    it("dismantleCarried sells the named carried item and swaps in the drop", () => {
      const drop = makeItem({
        instanceId: "drop-1",
        baseId: "war-blade",
        rarity: "rare",
      });
      const before = fullBackpackState([drop]);
      const carried = before.items[0];
      const after = reduce(before, {
        type: "ResolveLootTriage",
        action: "dismantleCarried",
        instanceId: carried.instanceId,
      });
      expect(after.items).toHaveLength(FIELD_BACKPACK_CAP);
      expect(after.items.map((i) => i.instanceId)).not.toContain(
        carried.instanceId,
      );
      expect(after.items.map((i) => i.instanceId)).toContain("drop-1");
      expect(after.gold).toBe(before.gold + itemSellPrice(carried));
      expect(after.pendingLootTriage).toBeNull();
    });

    it("no-ops dismantleCarried when the named instance isn't actually carried", () => {
      const drop = makeItem({ instanceId: "drop-1" });
      const before = fullBackpackState([drop]);
      const after = reduce(before, {
        type: "ResolveLootTriage",
        action: "dismantleCarried",
        instanceId: "not-carried",
      });
      expect(after.gold).toBe(before.gold);
      expect(after.pendingLootTriage).toEqual(before.pendingLootTriage);
      expect(after.log.at(-1)?.text).toBe("There is nothing to dismantle");
    });

    it("advances to the next queued drop without clearing until the queue empties", () => {
      const drop1 = makeItem({ instanceId: "drop-1" });
      const drop2 = makeItem({ instanceId: "drop-2" });
      const before = fullBackpackState([drop1, drop2]);
      const after = reduce(before, {
        type: "ResolveLootTriage",
        action: "dismantleDrop",
      });
      expect(after.pendingLootTriage?.drops.map((i) => i.instanceId)).toEqual([
        "drop-2",
      ]);
    });

    it("no-ops when nothing is pending", () => {
      const before = newGame(1);
      const after = reduce(before, {
        type: "ResolveLootTriage",
        action: "dismantleDrop",
      });
      expect(after.gold).toBe(before.gold);
      expect(after.log.at(-1)?.text).toBe("There is nothing awaiting triage");
    });
  });

  describe("OpenChest overflow queues triage instead of over-capping (ENG-5)", () => {
    it("queues the chest's generated item when the backpack is already full", () => {
      let state = withToughHero(enterDungeon(1234));
      const chest = findDungeonTile(state, "chest");
      expect(chest).toBeDefined();
      state = walkTo(state, chest ?? { x: 0, y: 0 });
      const filler = Array.from({ length: FIELD_BACKPACK_CAP }, (_, i) =>
        makeItem({ instanceId: `f-${i}` }),
      );
      state = { ...state, items: filler };
      const nextBefore = state.nextItemId;
      state = reduce(state, { type: "OpenChest" });
      expect(state.items).toHaveLength(FIELD_BACKPACK_CAP);
      expect(state.nextItemId).toBe(nextBefore + 1);
      expect(state.pendingLootTriage?.drops).toHaveLength(1);
      expect(state.log.at(-1)?.text).toMatch(/backpack is full/i);
    });
  });

  describe("finalizeWon overflow queues triage instead of over-capping (ENG-5)", () => {
    it("queues victory loot for triage when the backpack is already full", () => {
      let state = withToughHero(enterDungeon(1234));
      for (let floor = 1; floor < 3; floor++) {
        const stairs = findDungeonTile(state, "stairsDown");
        state = walkTo(state, stairs ?? { x: 0, y: 0 });
        state = reduce(state, { type: "DescendStairs" });
      }
      const boss = findDungeonTile(state, "bossMarker");
      state = walkTo(state, boss ?? { x: 0, y: 0 });
      expect(state.scene).toBe("battle");
      const filler = Array.from({ length: FIELD_BACKPACK_CAP }, (_, i) =>
        makeItem({ instanceId: `f-${i}` }),
      );
      state = { ...state, items: filler };
      const after = fightToResolution(state);
      expect(after.items).toHaveLength(FIELD_BACKPACK_CAP);
      expect(after.pendingLootTriage?.drops.length).toBeGreaterThanOrEqual(1);
      expect(after.log.some((l) => /backpack is full/i.test(l.text))).toBe(
        true,
      );
    });
  });

  describe("save/load: stash and field cap round-trip independently (ENG-5)", () => {
    it("round-trips stash and pendingLootTriage separately from the field backpack", () => {
      const stashed = Array.from({ length: 5 }, (_, i) =>
        makeItem({ instanceId: `s-${i}` }),
      );
      const drop = makeItem({ instanceId: "drop-x" });
      const before: GameState = {
        ...newGame(1),
        items: [makeItem({ instanceId: "carried-1" })],
        stash: stashed,
        pendingLootTriage: { drops: [drop] },
      };
      const after = deserialize(serialize(before));
      expect(after.stash).toHaveLength(5);
      expect(after.items).toHaveLength(1);
      expect(after.pendingLootTriage?.drops.map((i) => i.instanceId)).toEqual([
        "drop-x",
      ]);
    });

    it("back-fills stash and pendingLootTriage for saves that predate them", () => {
      const before = newGame(1);
      const legacy = JSON.parse(serialize(before));
      delete legacy.stash;
      delete legacy.pendingLootTriage;
      const restored = deserialize(JSON.stringify(legacy));
      expect(restored.stash).toEqual([]);
      expect(restored.pendingLootTriage).toBeNull();
    });
  });

  describe("end-to-end: kill boss -> implicit drop -> equip -> sell dupe", () => {
    it("reproduces the playable slice deterministically", () => {
      const runOnce = () => {
        let state = withToughHero(enterDungeon(1234));
        // Descend to floor 3, fighting through wandering encounters.
        for (let floor = 1; floor < 3; floor++) {
          const stairs = findDungeonTile(state, "stairsDown");
          state = walkTo(state, stairs ?? { x: 0, y: 0 });
          state = reduce(state, { type: "DescendStairs" });
        }
        const boss = findDungeonTile(state, "bossMarker");
        state = walkTo(state, boss ?? { x: 0, y: 0 });
        expect(state.scene).toBe("battle");
        return fightToResolution(state);
      };

      const state = runOnce();
      // Victory returns to the dungeon and clears the battle.
      expect(state.scene).toBe("dungeon");
      expect(state.battleState).toBeNull();
      // The boss kill yielded loot, including a unique signature (implicit) drop
      // rolled from the dungeon guardian's monster-implicit pool.
      expect(state.items.length).toBeGreaterThanOrEqual(1);
      const signature = state.items.find(
        (item) => item.baseId.startsWith("guardian-") && item.implicit !== null,
      );
      expect(signature).toBeDefined();
      expect(signature?.rarity).toBe("unique");

      // Equip the signature drop -> it leaves the backpack and fills a slot.
      const sigId = signature?.instanceId ?? "";
      let after = reduce(state, {
        type: "EquipItem",
        instanceId: sigId,
        memberId: state.party[0].id,
      });
      const inSlot = equipmentSlots().some(
        (slot) => after.party[0].equipment[slot]?.instanceId === sigId,
      );
      expect(inSlot).toBe(true);
      expect(after.items.map((i) => i.instanceId)).not.toContain(sigId);

      // Sell a dupe (the generic boss drop) in town -> gold rises, backpack shrinks.
      const dupe =
        after.items.find((i) => i.instanceId !== sigId) ?? after.items[0];
      expect(dupe).toBeDefined();
      const goldBefore = after.gold;
      after = reduce(after, { type: "SellItem", instanceId: dupe.instanceId });
      expect(after.gold).toBe(goldBefore + itemSellPrice(dupe));
      expect(after.items.map((i) => i.instanceId)).not.toContain(
        dupe.instanceId,
      );

      // The whole descend + boss fight path (loot included) is deterministic.
      expect(runOnce()).toEqual(runOnce());
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 6 (ROG-12): exit dungeon, death handling, save/restore integrity     */
/* -------------------------------------------------------------------------- */

/** Weaken the hero so a battle resolves to a loss (1 HP, zero stats). */
function withWeakHero(state: GameState): GameState {
  const weak: PartyMember = {
    ...state.party[0],
    hp: 1,
    maxHp: 1,
    mp: 0,
    maxMp: 0,
    stats: { str: 0, agi: 0, vit: 0, int: 0 },
  };
  return { ...state, party: [weak] };
}

/** A tough hero with a controlled strength so a battle lasts many rounds. */
function withControlledHero(state: GameState, str: number): GameState {
  const hero: PartyMember = {
    ...state.party[0],
    hp: 999,
    maxHp: 999,
    mp: 999,
    maxMp: 999,
    stats: { str, agi: 50, vit: 50, int: 50 },
  };
  return { ...state, party: [hero] };
}

/** Start a battle of the given kind on the current dungeon floor. */
function withBattle(state: GameState, kind: "wandering" | "boss"): GameState {
  const floor = state.dungeonState?.floor ?? 1;
  const rng = new Rng(state.seed, state.rngState);
  const battle = startBattle(rng, state.party, kind, floor, "dungeon");
  return {
    ...state,
    scene: "battle",
    rngState: rng.getState(),
    battleState: battle,
    dungeonState: state.dungeonState
      ? { ...state.dungeonState, encounter: { kind, floor } }
      : state.dungeonState,
  };
}

/** Drive an active battle by attacking until it resolves (win or lose). */
function fightToEnd(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 200 && s.scene === "battle"; i++) {
    const bs = s.battleState;
    if (!bs) break;
    const target = bs.enemies.find((enemy) => enemy.hp > 0);
    if (!target) break;
    s = reduce(s, { type: "BattleAttack", targetId: target.id });
  }
  return s;
}

describe("Phase 6: exit dungeon", () => {
  it("ExitDungeon (evac) returns to the overworld, clears dungeonState, and carries the encounter meter through unchanged", () => {
    const seed = 1;
    const map = generateOverworldMap(seed);
    const entrance = map.dungeonEntrances[0];
    const approach = findPassableNeighbor(map, entrance);
    const state = reduce(
      {
        ...newGame(seed),
        scene: "overworld" as const,
        worldState: { player: approach.from, encounterMeter: 42 },
      },
      { type: "MoveOverworld", dx: approach.dx, dy: approach.dy },
    );
    expect(state.scene).toBe("dungeon");
    expect(state.dungeonState).not.toBeNull();
    expect(state.worldState.encounterMeter).toBe(42);

    const after = reduce(state, { type: "ExitDungeon" });
    expect(after.scene).toBe("overworld");
    expect(after.dungeonState).toBeNull();
    expect(after.battleState).toBeNull();
    // ENG-1: evac deliberately no longer resets the danger accumulator.
    expect(after.worldState.encounterMeter).toBe(42);
    expect(after.log.at(-1)?.text).toBe("You emerge from the dungeon");
    // The player stays at the dungeon entrance tile on the overworld.
    expect(after.worldState.player).toEqual(map.dungeonEntrances[0]);
  });

  it("ExitDungeon is a no-op when not in a dungeon", () => {
    const state = newGame(1);
    const after = reduce(state, { type: "ExitDungeon" });
    expect(after).toBe(state);
  });

  it("full loop: enter dungeon, open chest, exit, then re-enter fresh", () => {
    let state = withToughHero(enterDungeon(1234));
    const chest = findDungeonTile(state, "chest");
    expect(chest).toBeDefined();
    state = walkTo(state, chest ?? { x: 0, y: 0 });
    state = reduce(state, { type: "OpenChest" });
    expect(state.gold).toBeGreaterThan(50);

    // Exit back to the overworld.
    state = reduce(state, { type: "ExitDungeon" });
    expect(state.scene).toBe("overworld");
    expect(state.dungeonState).toBeNull();

    // Re-enter the same dungeon entrance: a fresh floor 1 (cleared reset).
    const map = generateOverworldMap(1234);
    const entrance = map.dungeonEntrances[0];
    const approach = findPassableNeighbor(map, entrance);
    state = reduce(
      { ...state, worldState: { player: approach.from, encounterMeter: 0 } },
      { type: "MoveOverworld", dx: approach.dx, dy: approach.dy },
    );
    expect(state.scene).toBe("dungeon");
    expect(state.dungeonState?.floor).toBe(1);
    expect(state.dungeonState?.cleared).toBe(false);
  });
});

describe("Zoom (ENG-1 fast travel)", () => {
  it("is a no-op while in a dungeon", () => {
    const state = enterDungeon(1);
    const after = reduce(state, { type: "Zoom", waypointId: "village" });
    expect(after.scene).toBe("dungeon");
    expect(after.worldState.player).toEqual(state.worldState.player);
    expect(after.log.at(-1)?.text).toBe(
      "Evac the dungeon before fast-traveling",
    );
  });

  it("is a no-op mid-battle", () => {
    let state = enterDungeon(1);
    state = withBattle(state, "boss");
    expect(state.scene).toBe("battle");
    const after = reduce(state, { type: "Zoom", waypointId: "village" });
    expect(after.scene).toBe("battle");
    expect(after.log.at(-1)?.text).toBe(
      "Evac the dungeon before fast-traveling",
    );
  });

  it("is a no-op when the waypoint has not been activated yet", () => {
    const state = newGame(1);
    const after = reduce(state, { type: "Zoom", waypointId: "dungeon-0" });
    expect(after.scene).toBe(state.scene);
    expect(after.worldState.player).toEqual(state.worldState.player);
    expect(after.log.at(-1)?.text).toBe(
      "That destination has not been discovered yet",
    );
  });

  it('Zoom("village") from the overworld moves the player home without touching the encounter meter', () => {
    const seed = 1;
    const map = generateOverworldMap(seed);
    const before = {
      ...newGame(seed),
      scene: "overworld" as const,
      worldState: { player: { x: 1, y: 1 }, encounterMeter: 37 },
    };
    const after = reduce(before, { type: "Zoom", waypointId: "village" });
    expect(after.scene).toBe("village");
    expect(after.worldState.player).toEqual(map.village);
    expect(after.worldState.encounterMeter).toBe(37);
    expect(after.log.at(-1)?.text).toBe("You fast-travel to Village");
  });

  it("Zoom to a dungeon entrance from the village teleports without creating dungeonState", () => {
    const seed = 1;
    const map = generateOverworldMap(seed);
    const entrance = map.dungeonEntrances[0];
    const approach = findPassableNeighbor(map, entrance);
    const entered = reduce(
      {
        ...newGame(seed),
        scene: "overworld" as const,
        worldState: { player: approach.from, encounterMeter: 0 },
      },
      { type: "MoveOverworld", dx: approach.dx, dy: approach.dy },
    );
    const exited = reduce(entered, { type: "ExitDungeon" });
    const backInVillage = reduce(exited, {
      type: "Zoom",
      waypointId: "village",
    });

    const after = reduce(backInVillage, {
      type: "Zoom",
      waypointId: "dungeon-0",
    });
    expect(after.scene).toBe("overworld");
    expect(after.worldState.player).toEqual(entrance);
    expect(after.dungeonState).toBeNull();
  });

  it("round trip: village -> dungeon entrance -> Zoom home -> Zoom back out ends on the entrance tile in the overworld", () => {
    const seed = 1;
    const map = generateOverworldMap(seed);
    const entrance = map.dungeonEntrances[0];
    const approach = findPassableNeighbor(map, entrance);

    let state: GameState = {
      ...newGame(seed),
      scene: "overworld" as const,
      worldState: { player: approach.from, encounterMeter: 0 },
    };
    state = reduce(state, {
      type: "MoveOverworld",
      dx: approach.dx,
      dy: approach.dy,
    });
    expect(state.activatedWaypoints).toEqual(["village", "dungeon-0"]);

    state = reduce(state, { type: "ExitDungeon" });
    state = reduce(state, { type: "Zoom", waypointId: "village" });
    expect(state.scene).toBe("village");
    expect(state.worldState.player).toEqual(map.village);

    state = reduce(state, { type: "Zoom", waypointId: "dungeon-0" });
    expect(state.scene).toBe("overworld");
    expect(state.worldState.player).toEqual(entrance);
    expect(state.dungeonState).toBeNull();
  });

  it("a JSON round trip preserves activatedWaypoints", () => {
    const seed = 1;
    const map = generateOverworldMap(seed);
    const entrance = map.dungeonEntrances[0];
    const approach = findPassableNeighbor(map, entrance);
    const state = reduce(
      {
        ...newGame(seed),
        scene: "overworld" as const,
        worldState: { player: approach.from, encounterMeter: 0 },
      },
      { type: "MoveOverworld", dx: approach.dx, dy: approach.dy },
    );
    const restored: GameState = JSON.parse(JSON.stringify(state));
    expect(restored.activatedWaypoints).toEqual(state.activatedWaypoints);
  });

  it("a fresh new-game run resets activatedWaypoints back to just the village", () => {
    const seed = 1;
    const map = generateOverworldMap(seed);
    const entrance = map.dungeonEntrances[0];
    const approach = findPassableNeighbor(map, entrance);
    const state = reduce(
      {
        ...newGame(seed),
        scene: "overworld" as const,
        worldState: { player: approach.from, encounterMeter: 0 },
      },
      { type: "MoveOverworld", dx: approach.dx, dy: approach.dy },
    );
    expect(state.activatedWaypoints).toEqual(["village", "dungeon-0"]);

    const fresh = newGame(seed);
    expect(fresh.activatedWaypoints).toEqual(["village"]);
  });
});

describe("Phase 6: death handling", () => {
  it("default (permadeath=false): defeat revives at village with 1 HP and half gold lost", () => {
    let state = enterDungeon(1);
    state = { ...state, gold: 100 };
    state = withWeakHero(state);
    state = withBattle(state, "boss");
    expect(state.scene).toBe("battle");

    const result = fightToEnd(state);
    expect(result.scene).toBe("village");
    expect(result.battleState).toBeNull();
    expect(result.dungeonState).toBeNull();
    expect(result.party[0].hp).toBe(1);
    expect(result.party[0].mp).toBe(0);
    expect(result.gold).toBe(50); // 100 - floor(100/2)
    expect(result.flags.gameOver).toBe(false);
    expect(
      result.log.some((m) => m.text.includes("revived at the village")),
    ).toBe(true);
  });

  it("permadeath=true: defeat sets gameOver and ends the run", () => {
    let state = enterDungeon(1);
    state = {
      ...state,
      gold: 100,
      flags: { permadeath: true, gameOver: false },
    };
    state = withWeakHero(state);
    state = withBattle(state, "boss");
    expect(state.scene).toBe("battle");

    const result = fightToEnd(state);
    expect(result.flags.gameOver).toBe(true);
    expect(result.battleState).toBeNull();
    expect(result.dungeonState).toBeNull();
    expect(result.log.some((m) => m.text.includes("perished"))).toBe(true);
  });

  it("gold penalty floors at zero (losing with 0 gold keeps 0)", () => {
    let state = { ...enterDungeon(1), gold: 0 };
    state = withWeakHero(state);
    state = withBattle(state, "boss");
    const result = fightToEnd(state);
    expect(result.scene).toBe("village");
    expect(result.gold).toBe(0);
  });
});

describe("Phase 6: boss victory marks the dungeon cleared", () => {
  it("defeating the floor-3 boss sets cleared=true and logs completion", () => {
    let state = withToughHero(enterDungeon(1234));
    // Descend to floor 3, fighting through wandering encounters.
    for (let floor = 1; floor < 3; floor++) {
      const stairs = findDungeonTile(state, "stairsDown");
      state = walkTo(state, stairs ?? { x: 0, y: 0 });
      state = reduce(state, { type: "DescendStairs" });
    }
    const boss = findDungeonTile(state, "bossMarker");
    state = walkTo(state, boss ?? { x: 0, y: 0 });
    expect(state.scene).toBe("battle");
    expect(state.dungeonState?.encounter?.kind).toBe("boss");

    state = fightToResolution(state);
    expect(state.scene).toBe("dungeon");
    expect(state.battleState).toBeNull();
    expect(state.dungeonState?.cleared).toBe(true);
    expect(state.dungeonState?.encounter).toBeNull();
    expect(state.log.some((m) => m.text.includes("dungeon is cleared"))).toBe(
      true,
    );
  });

  it("a wandering victory does NOT mark the dungeon cleared", () => {
    let state = withToughHero(enterDungeon(1234));
    // Walk until a wandering encounter triggers.
    let found = false;
    for (let i = 0; i < 60 && !found; i++) {
      const ds = state.dungeonState;
      if (!ds) break;
      const path = bfsPath(
        ds.layout,
        ds.player,
        findDungeonTile(state, "stairsDown") ?? { x: 0, y: 0 },
      );
      if (!path || path.length < 2) break;
      const next = path[1];
      state = turnTo(state, facingFor(ds.player, next));
      state = reduce(state, { type: "StepDungeon", direction: "forward" });
      if (
        state.scene === "battle" &&
        state.dungeonState?.encounter?.kind === "wandering"
      ) {
        state = fightToResolution(state);
        expect(state.dungeonState?.cleared).toBe(false);
        found = true;
      }
    }
    // If no wandering encounter triggered, the cleared flag should still be false.
    if (!found) expect(state.dungeonState?.cleared).toBe(false);
  });
});

describe("Phase 6: save/restore integrity", () => {
  it("save/load round-trip mid-dungeon produces an identical final state", () => {
    const seed = 1234;

    const toCheckpoint = (s: GameState): GameState => {
      s = withToughHero(s);
      const chest = findDungeonTile(s, "chest");
      s = walkTo(s, chest ?? { x: 0, y: 0 });
      s = reduce(s, { type: "OpenChest" });
      return s;
    };

    const fromCheckpoint = (s: GameState): GameState => {
      const stairs = findDungeonTile(s, "stairsDown");
      s = walkTo(s, stairs ?? { x: 0, y: 0 });
      s = reduce(s, { type: "DescendStairs" });
      s = reduce(s, { type: "ExitDungeon" });
      return s;
    };

    const control = fromCheckpoint(toCheckpoint(enterDungeon(seed)));
    const restored = deserialize(serialize(toCheckpoint(enterDungeon(seed))));
    const testState = fromCheckpoint(restored);

    expect(testState).toEqual(control);
  });

  it("save/load round-trip mid-battle (battleState present) continues identically", () => {
    const seed = 1234;

    const toMidBattle = (s: GameState): GameState => {
      // Controlled strength so the boss (60 HP) survives the first hit and
      // the battle is still ongoing after one attack.
      s = withControlledHero(s, 10);
      s = withBattle(s, "boss");
      const target = s.battleState?.enemies.find((e) => e.hp > 0);
      if (!target) throw new Error("no living enemy at battle start");
      s = reduce(s, { type: "BattleAttack", targetId: target.id });
      // Battle must still be ongoing for a mid-battle save point.
      if (s.scene !== "battle" || !s.battleState) {
        throw new Error(
          "boss died in one hit; increase floor/HP for this seed",
        );
      }
      return s;
    };

    const control = fightToEnd(toMidBattle(enterDungeon(seed)));
    const restored = deserialize(serialize(toMidBattle(enterDungeon(seed))));
    const testState = fightToEnd(restored);

    expect(testState).toEqual(control);
  });

  it("state-hash reproducibility: same seed and loop produce byte-identical serialized state", () => {
    const seed = 2024;

    const runOnce = () => {
      let s = withToughHero(enterDungeon(seed));
      const chest = findDungeonTile(s, "chest");
      s = walkTo(s, chest ?? { x: 0, y: 0 });
      s = reduce(s, { type: "OpenChest" });
      const stairs = findDungeonTile(s, "stairsDown");
      s = walkTo(s, stairs ?? { x: 0, y: 0 });
      s = reduce(s, { type: "DescendStairs" });
      s = reduce(s, { type: "ExitDungeon" });
      return s;
    };

    const a = runOnce();
    const b = runOnce();
    expect(a).toEqual(b);
    expect(serialize(a)).toBe(serialize(b));
  });

  it("deserialize backfills flags and cleared for older saves", () => {
    // Simulate a pre-Phase-6 save that lacks `flags` and `cleared`. Typed as
    // a plain record so `delete` is allowed on what would be required fields.
    const legacy: Record<string, unknown> = JSON.parse(
      JSON.stringify({
        ...newGame(1),
        dungeonState: enterDungeon(1).dungeonState,
      }),
    );
    delete legacy.flags;
    const ds = legacy.dungeonState as Record<string, unknown> | undefined;
    if (ds) delete ds.cleared;

    const restored = deserialize(JSON.stringify(legacy));
    expect(restored.flags).toEqual({ permadeath: false, gameOver: false });
    expect(restored.dungeonState?.cleared).toBe(false);
  });

  it("full-loop save/load: serialize mid-dungeon, deserialize, and the final state matches a no-save control", () => {
    const seed = 1234;

    // A longer sequence: enter, open chest, descend, open another chest, exit.
    const runFull = (s: GameState): GameState => {
      s = withToughHero(s);
      const chest1 = findDungeonTile(s, "chest");
      s = walkTo(s, chest1 ?? { x: 0, y: 0 });
      s = reduce(s, { type: "OpenChest" });
      const stairs = findDungeonTile(s, "stairsDown");
      s = walkTo(s, stairs ?? { x: 0, y: 0 });
      s = reduce(s, { type: "DescendStairs" });
      const chest2 = findDungeonTile(s, "chest");
      if (chest2) {
        s = walkTo(s, chest2);
        s = reduce(s, { type: "OpenChest" });
      }
      s = reduce(s, { type: "ExitDungeon" });
      return s;
    };

    // Control: no save/load.
    const control = runFull(enterDungeon(seed));

    // Test: save after descending to floor 2, then continue.
    let testState = withToughHero(enterDungeon(seed));
    const chest1 = findDungeonTile(testState, "chest");
    testState = walkTo(testState, chest1 ?? { x: 0, y: 0 });
    testState = reduce(testState, { type: "OpenChest" });
    const stairs = findDungeonTile(testState, "stairsDown");
    testState = walkTo(testState, stairs ?? { x: 0, y: 0 });
    testState = reduce(testState, { type: "DescendStairs" });
    // Save mid-dungeon (on floor 2).
    testState = deserialize(serialize(testState));
    // Continue.
    const chest2 = findDungeonTile(testState, "chest");
    if (chest2) {
      testState = walkTo(testState, chest2);
      testState = reduce(testState, { type: "OpenChest" });
    }
    testState = reduce(testState, { type: "ExitDungeon" });

    expect(testState).toEqual(control);
  });

  describe("SetLootFilter (ENG-17 loot filter)", () => {
    it("updates GameState.lootFilter to the given rules", () => {
      const state = newGame(1);
      const rules: LootFilterRules = {
        minRarityByTier: { 1: "magic", 2: "rare" },
        minIlvlOffset: 0,
        keepAffixStats: ["str", "agi"],
      };
      const after = reduce(state, { type: "SetLootFilter", rules });
      expect(after.lootFilter).toEqual(rules);
      expect(after.lootFilter).not.toBe(state.lootFilter);
    });

    it("save/load round-trip preserves non-default lootFilter", () => {
      const rules: LootFilterRules = {
        minRarityByTier: { 1: "magic", 2: "rare" },
        minIlvlOffset: 0,
        keepAffixStats: ["str", "agi"],
      };
      const state = reduce(newGame(1), { type: "SetLootFilter", rules });
      const restored = deserialize(serialize(state));
      expect(restored.lootFilter).toEqual(rules);
    });

    it("old-save back-fill provides EMPTY_LOOT_FILTER when lootFilter is absent", () => {
      const before = newGame(1);
      const legacy = JSON.parse(serialize(before));
      delete legacy.lootFilter;
      const restored = deserialize(JSON.stringify(legacy));
      expect(restored.lootFilter).toEqual(EMPTY_LOOT_FILTER);
    });
  });
});

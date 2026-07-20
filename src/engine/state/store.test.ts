import { describe, expect, it } from "vitest";
import {
  generateOverworldMap,
  isPassable,
  tileAt,
} from "../world/overworld.js";
import { GameStore, INN_COST_PER_MEMBER, newGame, reduce } from "./store.js";

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
      expect(after.log.at(-1)).toBe("You step into a dungeon entrance");
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

import { describe, expect, it } from "vitest";
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
});

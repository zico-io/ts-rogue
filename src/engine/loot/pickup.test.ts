import { describe, expect, it } from "vitest";
import type { LootFilterRules } from "./lootFilter";
import {
  applyLootPickup,
  applyLootPickupWithFilter,
  buildLootFilterContext,
  queueLootTriage,
} from "./pickup";
import type { ItemInstance } from "./types";

function makeItem(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: "itm-test",
    baseId: "war-blade",
    rarity: "common",
    ilvl: 1,
    prefixes: [],
    suffixes: [],
    implicit: null,
    ...overrides,
  };
}

describe("buildLootFilterContext", () => {
  it("derives the dungeon tier from the floor via tierForFloor", () => {
    expect(buildLootFilterContext([{ level: 1 }], 1)).toEqual({
      dungeonTier: 1,
      partyLevel: 1,
    });
    expect(buildLootFilterContext([{ level: 1 }], 2)).toEqual({
      dungeonTier: 2,
      partyLevel: 1,
    });
    expect(buildLootFilterContext([{ level: 1 }], 5)).toEqual({
      dungeonTier: 3,
      partyLevel: 1,
    });
  });

  it("defaults dungeonTier to 1 when there is no active dungeon floor", () => {
    expect(buildLootFilterContext([{ level: 1 }], null)).toEqual({
      dungeonTier: 1,
      partyLevel: 1,
    });
  });

  it("uses the highest level across the party", () => {
    expect(
      buildLootFilterContext([{ level: 2 }, { level: 7 }, { level: 4 }], 1),
    ).toEqual({ dungeonTier: 1, partyLevel: 7 });
  });
});

describe("applyLootPickup", () => {
  it("accepts every drop when there is room", () => {
    const result = applyLootPickup(
      [makeItem({ instanceId: "a" })],
      [makeItem({ instanceId: "b" }), makeItem({ instanceId: "c" })],
      5,
    );
    expect(result.items.map((i) => i.instanceId)).toEqual(["a", "b", "c"]);
    expect(result.queued).toEqual([]);
  });

  it("fills only the remaining capacity and queues the rest, in order", () => {
    const items = [
      makeItem({ instanceId: "a" }),
      makeItem({ instanceId: "b" }),
    ];
    const drops = [
      makeItem({ instanceId: "c" }),
      makeItem({ instanceId: "d" }),
      makeItem({ instanceId: "e" }),
    ];
    const result = applyLootPickup(items, drops, 3);
    expect(result.items.map((i) => i.instanceId)).toEqual(["a", "b", "c"]);
    expect(result.queued.map((i) => i.instanceId)).toEqual(["d", "e"]);
  });

  it("queues every drop when already at cap, never extending items past it", () => {
    const items = [
      makeItem({ instanceId: "a" }),
      makeItem({ instanceId: "b" }),
      makeItem({ instanceId: "c" }),
    ];
    const drops = [
      makeItem({ instanceId: "d" }),
      makeItem({ instanceId: "e" }),
    ];
    const result = applyLootPickup(items, drops, 3);
    expect(result.items.map((i) => i.instanceId)).toEqual(["a", "b", "c"]);
    expect(result.queued.map((i) => i.instanceId)).toEqual(["d", "e"]);
  });

  it("never drops loot silently: items.length plus queued.length always equals the input total", () => {
    const items = [makeItem({ instanceId: "a" })];
    const drops = [
      makeItem({ instanceId: "b" }),
      makeItem({ instanceId: "c" }),
      makeItem({ instanceId: "d" }),
    ];
    const result = applyLootPickup(items, drops, 2);
    expect(result.items.length + result.queued.length).toBe(
      items.length + drops.length,
    );
  });
});

describe("queueLootTriage", () => {
  it("returns the existing pending queue unchanged when nothing new is queued", () => {
    const pending = { drops: [makeItem({ instanceId: "a" })] };
    expect(queueLootTriage(pending, [])).toBe(pending);
  });

  it("starts a fresh queue from null", () => {
    const result = queueLootTriage(null, [
      makeItem({ instanceId: "a" }),
      makeItem({ instanceId: "b" }),
    ]);
    expect(result?.drops.map((i) => i.instanceId)).toEqual(["a", "b"]);
  });

  it("appends onto an existing queue, preserving arrival order", () => {
    const pending = { drops: [makeItem({ instanceId: "a" })] };
    const result = queueLootTriage(pending, [makeItem({ instanceId: "b" })]);
    expect(result?.drops.map((i) => i.instanceId)).toEqual(["a", "b"]);
  });
});

describe("applyLootPickupWithFilter", () => {
  const emptyFilter: LootFilterRules = {
    minRarityByTier: {},
    keepAffixStats: [],
  };
  const emptyContext = { dungeonTier: 1, partyLevel: 1 };

  it("empty filter never dismantles, matching plain applyLootPickup behavior", () => {
    const items = [makeItem({ instanceId: "a" })];
    const drops = [
      makeItem({ instanceId: "b" }),
      makeItem({ instanceId: "c" }),
    ];
    const result = applyLootPickupWithFilter(
      items,
      drops,
      5,
      emptyFilter,
      emptyContext,
    );
    // Same result as plain applyLootPickup
    const plain = applyLootPickup(items, drops, 5);
    expect(result.items.map((i) => i.instanceId)).toEqual(
      plain.items.map((i) => i.instanceId),
    );
    expect(result.queued.map((i) => i.instanceId)).toEqual(
      plain.queued.map((i) => i.instanceId),
    );
    // Nothing dismantled
    expect(result.outcome.dismantled).toEqual([]);
    expect(result.outcome.goldGained).toBe(0);
    expect(result.outcome.kept.map((i) => i.instanceId)).toEqual(["b", "c"]);
  });

  describe("with a rarity-floor filter (minRarity=magic on tier 1)", () => {
    const filter: LootFilterRules = {
      minRarityByTier: { 1: "magic" },
      keepAffixStats: [],
    };
    const context = { dungeonTier: 1, partyLevel: 1 };

    it("keeps items that pass and dismantles items that fail the filter", () => {
      const items: ItemInstance[] = [];
      const drops = [
        makeItem({ instanceId: "common-sword", rarity: "common" }),
        makeItem({ instanceId: "magic-sword", rarity: "magic" }),
        makeItem({ instanceId: "rare-sword", rarity: "rare" }),
      ];
      const result = applyLootPickupWithFilter(
        items,
        drops,
        10,
        filter,
        context,
      );

      // Common should be dismantled (fails rarity floor)
      expect(result.outcome.dismantled.map((i) => i.instanceId)).toEqual([
        "common-sword",
      ]);
      // Magic and rare kept
      expect(result.outcome.kept.map((i) => i.instanceId)).toEqual([
        "magic-sword",
        "rare-sword",
      ]);
      // Gold from the dismantled common war-blade (baseValue=25 * common=1 = 25)
      expect(result.outcome.goldGained).toBe(25);
      // Items reflect only kept drops
      expect(result.items.map((i) => i.instanceId)).toEqual([
        "magic-sword",
        "rare-sword",
      ]);
      expect(result.queued).toEqual([]);
    });

    it("dismantles every drop when all fail the filter", () => {
      const drops = [
        makeItem({ instanceId: "a", rarity: "common" }),
        makeItem({ instanceId: "b", rarity: "common" }),
      ];
      const result = applyLootPickupWithFilter([], drops, 10, filter, context);

      expect(result.outcome.dismantled.map((i) => i.instanceId)).toEqual([
        "a",
        "b",
      ]);
      expect(result.outcome.kept).toEqual([]);
      expect(result.outcome.goldGained).toBe(50); // 25 + 25
      expect(result.items).toEqual([]);
      expect(result.queued).toEqual([]);
    });

    it("combines filtering with cap overflow: dismantled items go to gold, kept items still respect the cap", () => {
      // Start with 1 item, cap of 3, drops: 1 common (dismantled) + 3 magic (kept)
      const filler = makeItem({ instanceId: "filler" });
      const drops = [
        makeItem({ instanceId: "dismantled-1", rarity: "common" }),
        makeItem({ instanceId: "kept-1", rarity: "magic" }),
        makeItem({ instanceId: "kept-2", rarity: "magic" }),
        makeItem({ instanceId: "kept-3", rarity: "magic" }),
      ];
      const result = applyLootPickupWithFilter(
        [filler],
        drops,
        3,
        filter,
        context,
      );

      // One dismantled
      expect(result.outcome.dismantled.map((i) => i.instanceId)).toEqual([
        "dismantled-1",
      ]);
      expect(result.outcome.goldGained).toBe(25);
      expect(result.outcome.kept).toHaveLength(3);

      // Cap of 3, filler takes 1 slot, so only 2 kept drops fit
      expect(result.items).toHaveLength(3);
      expect(result.items.map((i) => i.instanceId)).toEqual([
        "filler",
        "kept-1",
        "kept-2",
      ]);
      // 1 kept drop overflows to queued
      expect(result.queued.map((i) => i.instanceId)).toEqual(["kept-3"]);
    });
  });
});

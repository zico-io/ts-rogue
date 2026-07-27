import { describe, expect, it } from "vitest";
import { findAffix } from "../../data/affixes";
import { dungeonDefFor, floorBandFor } from "../../data/dungeons";
import { findImplicitPool } from "../../data/implicitPools";
import { findLootTable } from "../../data/lootTables";
import { Rng } from "../rng/rng";
import { describeItem, itemSellPrice, itemStats } from "./items";
import {
  DEFAULT_RARITY_WEIGHTS,
  rollChestLoot,
  rollEnemyLoot,
  rollImplicitPool,
  rollLootTable,
  rollRarity,
  rollVictoryLoot,
} from "./resolution";
import type { Rarity, RarityWeights } from "./types";

const WEIGHTS: RarityWeights = { common: 60, magic: 30, rare: 9, unique: 1 };

describe("rollRarity", () => {
  it("asserts exact rarities for fixed seeds (exact rolls)", () => {
    expect(rollRarity(new Rng(1), WEIGHTS)).toBe("common");
    expect(rollRarity(new Rng(1233), WEIGHTS)).toBe("magic");
    expect(rollRarity(new Rng(1849), WEIGHTS)).toBe("rare");
    expect(rollRarity(new Rng(2033), WEIGHTS)).toBe("unique");
  });

  it("is deterministic and always returns a valid rarity", () => {
    const valid: Rarity[] = ["common", "magic", "rare", "unique"];
    for (let seed = 1; seed <= 500; seed++) {
      const a = rollRarity(new Rng(seed), WEIGHTS);
      const b = rollRarity(new Rng(seed), WEIGHTS);
      expect(a).toBe(b);
      expect(valid).toContain(a);
    }
  });
});

describe("rollLootTable", () => {
  it("rolls an exact rare Rusty Dagger for tier-1 seed 123", () => {
    const table = findLootTable("tier-1");
    expect(table).toBeDefined();
    const result = rollLootTable(new Rng(123), table as never, 1);
    expect(result.nextId).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      instanceId: "itm-1",
      baseId: "rusty-dagger",
      rarity: "rare",
      ilvl: 1,
      prefixes: [
        { affixId: "sturdy", value: 1 },
        { affixId: "clever", value: 3 },
      ],
      suffixes: [
        { affixId: "of-vitality", value: 2 },
        { affixId: "of-evasion", value: 1 },
        { affixId: "of-might", value: 4 },
      ],
      implicit: null,
    });
    expect(describeItem(result.items[0])).toBe(
      "Rare Sturdy Rusty Dagger of Vitality",
    );
    expect(itemStats(result.items[0])).toEqual({
      str: 5,
      agi: 1,
      vit: 3,
      int: 3,
    });
    expect(itemSellPrice(result.items[0])).toBe(26);
  });

  it("is deterministic", () => {
    const table = findLootTable("tier-1") as never;
    const runOnce = () => rollLootTable(new Rng(999), table, 7);
    expect(runOnce()).toEqual(runOnce());
  });

  it("drops nothing when dropChance is 0", () => {
    const empty = rollLootTable(
      new Rng(1),
      {
        id: "none",
        dropChance: 0,
        rarityWeights: WEIGHTS,
        items: [{ baseId: "tunic", weight: 1 }],
      },
      1,
    );
    expect(empty).toEqual({ items: [], nextId: 1 });
  });
});

describe("rollImplicitPool", () => {
  it("rolls an exact unique signature Guardian's Bulwark for the boss pool seed 456", () => {
    const pool = findImplicitPool("boss_dungeon_guardian");
    expect(pool).toBeDefined();
    const result = rollImplicitPool(new Rng(456), pool as never, 1);
    expect(result.nextId).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      instanceId: "itm-1",
      baseId: "guardian-bulwark",
      rarity: "unique",
      ilvl: 12,
      prefixes: [
        { affixId: "vicious", value: 5 },
        { affixId: "clever", value: 3 },
      ],
      suffixes: [
        { affixId: "of-might", value: 2 },
        { affixId: "of-sorcery", value: 3 },
      ],
      implicit: { affixId: "sig-warding", value: 10 },
    });
    expect(describeItem(result.items[0])).toBe(
      "Unique Vicious Guardian's Bulwark of Might",
    );
    expect(itemStats(result.items[0])).toEqual({
      str: 7,
      agi: 0,
      vit: 16,
      int: 6,
    });
    expect(itemSellPrice(result.items[0])).toBe(173);
  });

  it("boss pool always drops (dropChance 1)", () => {
    const pool = findImplicitPool("boss_dungeon_guardian") as never;
    let drops = 0;
    for (let seed = 1; seed <= 200; seed++) {
      if (rollImplicitPool(new Rng(seed), pool, 1).items.length > 0) drops++;
    }
    expect(drops).toBe(200);
  });

  it("slime type pool is infrequent (~8%) and carries the sig-ooze implicit", () => {
    const pool = findImplicitPool("type_slime");
    expect(pool).toBeDefined();
    if (!pool) return;
    expect(pool.dropChance).toBeCloseTo(0.08);

    const rng = new Rng(42);
    let drops = 0;
    for (let i = 0; i < 1000; i++) {
      const result = rollImplicitPool(rng, pool, 1);
      if (result.items.length > 0) {
        drops++;
        expect(result.items[0].implicit?.affixId).toBe("sig-ooze");
      }
    }

    expect(drops).toBeGreaterThan(50);
    expect(drops).toBeLessThan(130);
  });
});

describe("rollEnemyLoot", () => {
  it("yields a generic drop and a unique signature drop for the dungeon guardian (seed 789)", () => {
    const result = rollEnemyLoot(new Rng(789), "dungeon-guardian", 1);
    expect(result.nextId).toBe(3);
    expect(result.items).toHaveLength(2);
    const generic = result.items.find((i) => i.implicit === null);
    const signature = result.items.find((i) => i.implicit !== null);
    expect(generic).toBeDefined();
    expect(generic?.rarity).toBe("common");
    expect(generic?.baseId).toBe("war-blade");
    expect(signature).toBeDefined();
    expect(signature?.rarity).toBe("unique");
    expect(signature?.baseId).toBe("guardian-bulwark");
    expect(signature?.implicit?.affixId).toBe("sig-warding");
  });

  it("is deterministic", () => {
    const runOnce = () => rollEnemyLoot(new Rng(789), "dungeon-guardian", 1);
    expect(runOnce()).toEqual(runOnce());
  });

  it("no-ops for an unknown monster", () => {
    expect(rollEnemyLoot(new Rng(1), "does-not-exist", 1)).toEqual({
      items: [],
      nextId: 1,
    });
  });
});

describe("rollVictoryLoot", () => {
  it("only rolls loot for defeated (hp <= 0) enemies", () => {
    const dead = rollVictoryLoot(
      new Rng(789),
      [{ defId: "dungeon-guardian", hp: 0 }],
      1,
    );
    expect(dead.items).toHaveLength(2);
    expect(dead.nextId).toBe(3);
    const alive = rollVictoryLoot(
      new Rng(789),
      [{ defId: "dungeon-guardian", hp: 50 }],
      1,
    );
    expect(alive).toEqual({ items: [], nextId: 1 });
  });
});

describe("rollChestLoot", () => {
  it("rolls an exact Common Tunic for floor 1 seed 321", () => {
    const result = rollChestLoot(new Rng(321), 1, 1);
    expect(result.nextId).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      instanceId: "itm-1",
      baseId: "tunic",
      rarity: "common",
      ilvl: 1,
      prefixes: [],
      suffixes: [],
      implicit: null,
    });
    expect(describeItem(result.items[0])).toBe("Common Tunic");
  });

  it("chests always drop a generated item on every floor", () => {
    for (let floor = 1; floor <= 3; floor++) {
      let drops = 0;
      for (let seed = 1; seed <= 50; seed++) {
        if (rollChestLoot(new Rng(seed), floor, 1).items.length > 0) drops++;
      }
      expect(drops).toBe(50);
    }
  });
});

describe("dungeon floor-band loot scaling (ROG-92)", () => {
  it("rollChestLoot draws a higher-ilvl item from a deeper floor band, same dungeon/seed", () => {
    const seed = 42;
    const shallow = rollChestLoot(new Rng(seed), 1, 1, "sunken-crypt");
    const deep = rollChestLoot(new Rng(seed), 3, 1, "sunken-crypt");
    expect(shallow.items).toHaveLength(1);
    expect(deep.items).toHaveLength(1);
    expect(deep.items[0].ilvl).toBeGreaterThan(shallow.items[0].ilvl);
  });

  it("rollChestLoot only pulls from the floor band's own table, never the neighboring band's", () => {
    const shallowTableIds = new Set(
      (findLootTable("chest-1")?.items ?? []).map((item) => item.baseId),
    );
    const deepTableIds = new Set(
      (findLootTable("chest-2")?.items ?? []).map((item) => item.baseId),
    );
    for (let seed = 1; seed <= 30; seed++) {
      const shallow = rollChestLoot(new Rng(seed), 1, 1, "sunken-crypt");
      const deep = rollChestLoot(new Rng(seed), 3, 1, "sunken-crypt");
      expect(shallowTableIds.has(shallow.items[0].baseId)).toBe(true);
      expect(deepTableIds.has(deep.items[0].baseId)).toBe(true);
    }
  });

  it("rollVictoryLoot with a dungeon context overrides the monster's own tier with the floor band's table", () => {
    const dungeon = dungeonDefFor("howling-cave");
    const shallowRef = floorBandFor(dungeon, 1).lootTableRef;
    const deepRef = floorBandFor(dungeon, 4).lootTableRef;
    expect(shallowRef).toBe("tier-2");
    expect(deepRef).toBe("tier-3");

    const enemies = [{ defId: "slime", hp: 0 }];
    let shallowMaxIlvl = 0;
    let deepMaxIlvl = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const shallow = rollVictoryLoot(new Rng(seed), enemies, 1, {
        dungeonId: "howling-cave",
        floor: 1,
      });
      const deep = rollVictoryLoot(new Rng(seed), enemies, 1, {
        dungeonId: "howling-cave",
        floor: 4,
      });
      for (const item of shallow.items) {
        shallowMaxIlvl = Math.max(shallowMaxIlvl, item.ilvl);
      }
      for (const item of deep.items) {
        deepMaxIlvl = Math.max(deepMaxIlvl, item.ilvl);
      }
    }
    // Slime's own lootTableRef is "tier-1" (max ilvl 1); with dungeon context
    // both floors should instead draw from tier-2/tier-3 (max ilvl 5 and 10).
    expect(shallowMaxIlvl).toBeGreaterThan(1);
    expect(deepMaxIlvl).toBeGreaterThan(shallowMaxIlvl);
  });
});

describe("loot bounds", () => {
  it("every guardian roll yields valid rarities, in-range affix values, and ilvl-gated affixes", () => {
    const valid: Rarity[] = ["common", "magic", "rare", "unique"];
    for (let seed = 1; seed <= 200; seed++) {
      const result = rollEnemyLoot(new Rng(seed), "dungeon-guardian", 1);
      for (const item of result.items) {
        expect(valid).toContain(item.rarity);
        expect(item.instanceId).toMatch(/^itm-\d+$/);
        for (const affix of [
          item.implicit,
          ...item.prefixes,
          ...item.suffixes,
        ]) {
          if (!affix) continue;
          const def = findAffix(affix.affixId);
          expect(def).toBeDefined();
          expect(affix.value).toBeGreaterThanOrEqual(def?.min ?? NaN);
          expect(affix.value).toBeLessThanOrEqual(def?.max ?? NaN);

          if (!affix.affixId.startsWith("sig-")) {
            expect(def?.ilvl).toBeLessThanOrEqual(item.ilvl);
          }
        }
      }
    }
  });

  it("stamps sequential instance ids from startId", () => {
    const result = rollVictoryLoot(
      new Rng(789),
      [
        { defId: "dungeon-guardian", hp: 0 },
        { defId: "slime", hp: 0 },
      ],
      5,
    );
    expect(result.nextId).toBe(5 + result.items.length);
    result.items.forEach((item, index) => {
      expect(item.instanceId).toBe(`itm-${5 + index}`);
    });
  });
});

describe("DEFAULT_RARITY_WEIGHTS", () => {
  it("is defined", () => {
    expect(DEFAULT_RARITY_WEIGHTS).toBeDefined();
    expect(DEFAULT_RARITY_WEIGHTS.unique).toBe(1);
  });
});

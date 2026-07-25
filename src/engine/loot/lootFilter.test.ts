import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOOT_FILTER,
  type LootFilterSettings,
  shouldDismantle,
} from "./lootFilter";
import type { ItemInstance } from "./types";

function makeItem(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: "itm-1",
    baseId: "short-sword",
    rarity: "common",
    ilvl: 1,
    prefixes: [],
    suffixes: [],
    implicit: null,
    ...overrides,
  };
}

function filter(
  overrides: Partial<LootFilterSettings> = {},
): LootFilterSettings {
  return { ...DEFAULT_LOOT_FILTER, enabled: true, ...overrides };
}

describe("shouldDismantle", () => {
  it("never dismantles when the filter is disabled", () => {
    const item = makeItem({ rarity: "common", ilvl: 1 });
    expect(shouldDismantle(item, DEFAULT_LOOT_FILTER, 50)).toBe(false);
  });

  it("dismantles a common item well below party level when enabled", () => {
    const item = makeItem({ rarity: "common", ilvl: 1 });
    const f = filter({ minRarity: "magic", minIlvlOffset: 0 });
    expect(shouldDismantle(item, f, 20)).toBe(true);
  });

  it("keeps an item at or above the rarity bar even if ilvl is low", () => {
    const item = makeItem({ rarity: "rare", ilvl: 1 });
    const f = filter({ minRarity: "magic", minIlvlOffset: 0 });
    expect(shouldDismantle(item, f, 20)).toBe(false);
  });

  it("keeps an item whose ilvl is close enough to party level even if rarity is low", () => {
    const item = makeItem({ rarity: "common", ilvl: 18 });
    const f = filter({ minRarity: "unique", minIlvlOffset: 0 });
    expect(shouldDismantle(item, f, 15)).toBe(false);
  });

  it("keeps an item carrying a listed keep-affix stat regardless of rarity/ilvl", () => {
    const item = makeItem({
      rarity: "common",
      ilvl: 1,
      prefixes: [{ affixId: "brute", value: 2 }],
    });
    const f = filter({
      minRarity: "unique",
      minIlvlOffset: 0,
      keepAffixStats: ["str"],
    });
    expect(shouldDismantle(item, f, 50)).toBe(false);
  });

  it("dismantles when all three checks fail", () => {
    const item = makeItem({
      rarity: "common",
      ilvl: 1,
      prefixes: [{ affixId: "nimble", value: 2 }],
    });
    const f = filter({
      minRarity: "unique",
      minIlvlOffset: 0,
      keepAffixStats: ["str"],
    });
    expect(shouldDismantle(item, f, 50)).toBe(true);
  });
});

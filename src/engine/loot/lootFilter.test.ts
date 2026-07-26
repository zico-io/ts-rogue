import { describe, expect, it } from "vitest";
import {
  EMPTY_LOOT_FILTER,
  type LootFilterRules,
  shouldDismantle,
} from "./lootFilter";
import type { ItemInstance, RolledAffix } from "./types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Build an `ItemInstance` with sensible defaults for filter tests. */
function makeItem(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: "itm-test",
    baseId: "war-blade",
    rarity: "common",
    ilvl: 5,
    prefixes: [],
    suffixes: [],
    implicit: null,
    ...overrides,
  };
}

function affix(affixId: string, value = 1): RolledAffix {
  return { affixId, value };
}

const defaultContext = { dungeonTier: 1, partyLevel: 5 };

// ---------------------------------------------------------------------------
// shouldDismantle
// ---------------------------------------------------------------------------

describe("shouldDismantle", () => {
  describe("no rules configured", () => {
    it("never dismantles any item when filter is empty", () => {
      expect(
        shouldDismantle(makeItem(), EMPTY_LOOT_FILTER, defaultContext),
      ).toBe(false);
    });

    it("never dismantles even a common ilvl-1 item with no affixes", () => {
      const item = makeItem({ rarity: "common", ilvl: 1 });
      expect(shouldDismantle(item, EMPTY_LOOT_FILTER, defaultContext)).toBe(
        false,
      );
    });
  });

  describe("rarity floor only", () => {
    const rules: LootFilterRules = {
      ...EMPTY_LOOT_FILTER,
      minRarityByTier: { 1: "magic" },
    };

    it("dismantles an item below the floor for that tier", () => {
      const item = makeItem({ rarity: "common" });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(true);
    });

    it("keeps an item at the floor", () => {
      const item = makeItem({ rarity: "magic" });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("keeps an item above the floor", () => {
      const item = makeItem({ rarity: "rare" });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("keeps a unique item above the floor", () => {
      const item = makeItem({ rarity: "unique" });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("a tier with no configured floor never dismantles on rarity grounds alone", () => {
      const ctx = { ...defaultContext, dungeonTier: 2 };
      const item = makeItem({ rarity: "common" });
      expect(shouldDismantle(item, rules, ctx)).toBe(false);
    });
  });

  describe("ilvl floor only", () => {
    const rules: LootFilterRules = {
      ...EMPTY_LOOT_FILTER,
      minIlvlOffset: 0,
    };

    it("dismantles an item below partyLevel + offset", () => {
      const item = makeItem({ ilvl: 4 });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(true);
    });

    it("keeps an item at partyLevel + offset", () => {
      const item = makeItem({ ilvl: 5 });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("keeps an item above partyLevel + offset", () => {
      const item = makeItem({ ilvl: 10 });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("negative offset tolerates under-leveled ilvl", () => {
      const tolerant: LootFilterRules = {
        ...EMPTY_LOOT_FILTER,
        minIlvlOffset: -2,
      };
      const item = makeItem({ ilvl: 3 });
      expect(
        shouldDismantle(item, tolerant, { dungeonTier: 1, partyLevel: 5 }),
      ).toBe(false);
    });
  });

  describe("affix keep-list only", () => {
    const rules: LootFilterRules = {
      ...EMPTY_LOOT_FILTER,
      keepAffixStats: ["str"],
    };

    it("keeps an item with a matching stat in its implicit", () => {
      const item = makeItem({ implicit: affix("brute") });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("keeps an item with a matching stat in a prefix", () => {
      const item = makeItem({ prefixes: [affix("brute")] });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("keeps an item with a matching stat in a suffix", () => {
      const item = makeItem({ suffixes: [affix("of-might")] });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("dismantles an item with only non-matching-stat affixes", () => {
      const item = makeItem({ prefixes: [affix("nimble")] });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(true);
    });

    it("dismantles an item with no affixes at all", () => {
      const item = makeItem();
      expect(shouldDismantle(item, rules, defaultContext)).toBe(true);
    });
  });

  describe("safety-net combination", () => {
    it("keeps an item that fails rarity AND ilvl but passes the affix keep-list", () => {
      const rules: LootFilterRules = {
        minRarityByTier: { 1: "magic" },
        minIlvlOffset: 0,
        keepAffixStats: ["str"],
      };
      // Common rarity (below magic floor), ilvl 4 (below partyLevel 5), but
      // has a str affix -> keep.
      const item = makeItem({
        rarity: "common",
        ilvl: 4,
        prefixes: [affix("brute")],
      });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(false);
    });

    it("dismantles an item that fails ALL three configured conditions", () => {
      const rules: LootFilterRules = {
        minRarityByTier: { 1: "magic" },
        minIlvlOffset: 0,
        keepAffixStats: ["str"],
      };
      // Common rarity, ilvl 4, no str affix -> all fail -> dismantle.
      const item = makeItem({
        rarity: "common",
        ilvl: 4,
        prefixes: [affix("nimble")],
      });
      expect(shouldDismantle(item, rules, defaultContext)).toBe(true);
    });
  });
});

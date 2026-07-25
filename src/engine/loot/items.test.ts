import { describe, expect, it } from "vitest";
import {
  describeAffixes,
  describeItem,
  itemAffixValueSum,
  itemBaseSlot,
  itemSellPrice,
  itemStatLine,
  itemStats,
  RARITY_LABEL,
  RARITY_SELL_MULTIPLIER,
} from "./items";
import type { ItemInstance } from "./types";

/** A unique Guardian's Bulwark with a rolled str prefix/suffix and the signature vit implicit. */
const BULWARK: ItemInstance = {
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
};

const RUSTY: ItemInstance = {
  instanceId: "itm-2",
  baseId: "rusty-dagger",
  rarity: "common",
  ilvl: 1,
  prefixes: [],
  suffixes: [],
  implicit: null,
};

describe("RARITY_LABEL / RARITY_SELL_MULTIPLIER", () => {
  it("labels and prices rarities", () => {
    expect(RARITY_LABEL.unique).toBe("Unique");
    expect(RARITY_SELL_MULTIPLIER.common).toBe(1);
    expect(RARITY_SELL_MULTIPLIER.unique).toBe(5);
  });
});

describe("itemStats", () => {
  it("sums base stats, rolled affixes, and the implicit", () => {
    expect(itemStats(BULWARK)).toEqual({ str: 7, agi: 0, vit: 16, int: 6 });
  });

  it("returns just the base stats for a plain common item", () => {
    expect(itemStats(RUSTY)).toEqual({ str: 1, agi: 0, vit: 0, int: 0 });
  });
});

describe("itemAffixValueSum", () => {
  it("sums every rolled and implicit affix value", () => {
    expect(itemAffixValueSum(BULWARK)).toBe(23);
    expect(itemAffixValueSum(RUSTY)).toBe(0);
  });
});

describe("itemSellPrice", () => {
  it("is base value times the rarity multiplier plus total affix value", () => {
    // floor(30 * 5) + 23 = 173
    expect(itemSellPrice(BULWARK)).toBe(173);
    // floor(5 * 1) + 0 = 5
    expect(itemSellPrice(RUSTY)).toBe(5);
  });
});

describe("itemBaseSlot", () => {
  it("reads the slot from the base", () => {
    expect(itemBaseSlot(BULWARK)).toBe("armor");
    expect(itemBaseSlot(RUSTY)).toBe("weapon");
  });
});

describe("describeItem", () => {
  it("prepends the first prefix and appends the first suffix onto the rarity + base name", () => {
    expect(describeItem(BULWARK)).toBe(
      "Unique Vicious Guardian's Bulwark of Might",
    );
    expect(describeItem(RUSTY)).toBe("Common Rusty Dagger");
  });
});

describe("itemStatLine", () => {
  it("lists signed stat bonuses and the implicit", () => {
    expect(itemStatLine(BULWARK)).toBe(
      "+7 STR +16 VIT +6 INT (implicit: of the Guardian +10 VIT)",
    );
    expect(itemStatLine(RUSTY)).toBe("+1 STR");
  });
});

describe("describeAffixes", () => {
  it("lists the implicit, prefixes, and suffixes as separate lines", () => {
    expect(describeAffixes(BULWARK)).toEqual([
      "Implicit: of the Guardian (+10 VIT)",
      "Prefix: Vicious (+5 STR)",
      "Prefix: Clever (+3 INT)",
      "Suffix: of Might (+2 STR)",
      "Suffix: of Sorcery (+3 INT)",
    ]);
  });

  it("is empty for a plain item with no affixes", () => {
    expect(describeAffixes(RUSTY)).toEqual([]);
  });
});

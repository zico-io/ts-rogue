import { describe, expect, it } from "vitest";
import {
  battleItemEffectLabel,
  CURE_ITEMS,
  consumeItem,
  curedEffects,
  HEAL_ITEMS,
  healAmount,
  isCureItem,
  isHealItem,
  isUsableBattleItem,
} from "./consumables";

describe("heal items", () => {
  it("recognizes potions and reports their heal amount", () => {
    expect(isHealItem("potion")).toBe(true);
    expect(healAmount("potion")).toBe(HEAL_ITEMS.potion);
    expect(isHealItem("antidote")).toBe(false);
    expect(healAmount("antidote")).toBe(0);
  });
});

describe("cure items", () => {
  it("Antidote cures poison only", () => {
    expect(isCureItem("antidote")).toBe(true);
    expect(curedEffects("antidote")).toEqual(["poison"]);
  });

  it("Thermal Salts cure both burn and chilled", () => {
    expect(isCureItem("thermal-salts")).toBe(true);
    expect(curedEffects("thermal-salts")).toEqual(CURE_ITEMS["thermal-salts"]);
    expect(curedEffects("thermal-salts")).toEqual(["burn", "chilled"]);
  });

  it("a non-cure item has no cured effects", () => {
    expect(isCureItem("potion")).toBe(false);
    expect(curedEffects("potion")).toEqual([]);
  });
});

describe("isUsableBattleItem", () => {
  it("is true for heal items and cure items, false otherwise", () => {
    expect(isUsableBattleItem("potion")).toBe(true);
    expect(isUsableBattleItem("antidote")).toBe(true);
    expect(isUsableBattleItem("thermal-salts")).toBe(true);
    expect(isUsableBattleItem("leather-armor")).toBe(false);
  });
});

describe("battleItemEffectLabel", () => {
  it("describes heal items by amount and cure items by cured status names", () => {
    expect(battleItemEffectLabel("potion")).toBe("heal 30");
    expect(battleItemEffectLabel("antidote")).toBe("cures Poison");
    expect(battleItemEffectLabel("thermal-salts")).toBe("cures Burn & Chilled");
    expect(battleItemEffectLabel("leather-armor")).toBe("");
  });
});

describe("consumeItem", () => {
  it("decrements quantity and drops the entry once it reaches zero", () => {
    const inventory = [{ itemId: "antidote", quantity: 2 }];
    const once = consumeItem(inventory, "antidote");
    expect(once).toEqual([{ itemId: "antidote", quantity: 1 }]);
    const twice = consumeItem(once, "antidote");
    expect(twice).toEqual([]);
  });

  it("is a no-op copy when the item is not owned", () => {
    const inventory = [{ itemId: "potion", quantity: 1 }];
    expect(consumeItem(inventory, "antidote")).toEqual(inventory);
  });
});

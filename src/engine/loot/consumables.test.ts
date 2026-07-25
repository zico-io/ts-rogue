import { describe, expect, it } from "vitest";
import { consumeItem, healAmount, isHealItem } from "./consumables";

describe("isHealItem / healAmount", () => {
  it("recognizes the known heal items and their amounts", () => {
    expect(isHealItem("potion")).toBe(true);
    expect(isHealItem("hi-potion")).toBe(true);
    expect(healAmount("potion")).toBe(30);
    expect(healAmount("hi-potion")).toBe(99);
  });

  it("treats an unknown item as not a heal item with zero amount", () => {
    expect(isHealItem("antidote")).toBe(false);
    expect(healAmount("antidote")).toBe(0);
  });
});

describe("consumeItem", () => {
  it("decrements a stack with more than one unit", () => {
    const result = consumeItem([{ itemId: "potion", quantity: 3 }], "potion");
    expect(result).toEqual([{ itemId: "potion", quantity: 2 }]);
  });

  it("removes the stack entirely once it reaches zero", () => {
    const result = consumeItem([{ itemId: "potion", quantity: 1 }], "potion");
    expect(result).toEqual([]);
  });

  it("is a no-op (shallow copy) when the item is not owned", () => {
    const inventory = [{ itemId: "antidote", quantity: 2 }];
    const result = consumeItem(inventory, "potion");
    expect(result).toEqual(inventory);
    expect(result).not.toBe(inventory);
  });

  it("leaves other stacks untouched", () => {
    const inventory = [
      { itemId: "potion", quantity: 1 },
      { itemId: "hi-potion", quantity: 2 },
    ];
    const result = consumeItem(inventory, "potion");
    expect(result).toEqual([{ itemId: "hi-potion", quantity: 2 }]);
  });
});

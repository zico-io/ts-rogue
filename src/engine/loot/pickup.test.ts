import { describe, expect, it } from "vitest";
import { FIELD_BACKPACK_CAP } from "./inventory";
import { DEFAULT_LOOT_FILTER, type LootFilterSettings } from "./lootFilter";
import { applyLootPickup } from "./pickup";
import type { ItemInstance } from "./types";

function makeItem(
  id: string,
  overrides: Partial<ItemInstance> = {},
): ItemInstance {
  return {
    instanceId: id,
    baseId: "rusty-dagger",
    rarity: "common",
    ilvl: 1,
    prefixes: [],
    suffixes: [],
    implicit: null,
    ...overrides,
  };
}

describe("applyLootPickup", () => {
  it("keeps every drop when there is no overflow", () => {
    const result = applyLootPickup(
      [],
      [makeItem("a"), makeItem("b")],
      DEFAULT_LOOT_FILTER,
      1,
    );
    expect(result.items.map((i) => i.instanceId)).toEqual(["a", "b"]);
    expect(result.kept.map((i) => i.instanceId)).toEqual(["a", "b"]);
    expect(result.dismantled).toEqual([]);
    expect(result.gold).toBe(0);
    expect(result.pendingLootTriage).toBeNull();
  });

  it("auto-dismantles everything the filter rejects, with no triage", () => {
    const filter: LootFilterSettings = {
      enabled: true,
      minRarity: "unique",
      minIlvlOffset: 0,
      keepAffixStats: [],
    };
    const result = applyLootPickup(
      [],
      [makeItem("a"), makeItem("b")],
      filter,
      50,
    );
    expect(result.items).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.dismantled.map((i) => i.instanceId)).toEqual(["a", "b"]);
    expect(result.gold).toBeGreaterThan(0);
    expect(result.pendingLootTriage).toBeNull();
  });

  it("produces a pending triage with an empty queue when the last drop overflows", () => {
    const currentItems = Array.from({ length: FIELD_BACKPACK_CAP }, (_, i) =>
      makeItem(`existing-${i}`),
    );
    const overflow = makeItem("overflow");
    const result = applyLootPickup(
      currentItems,
      [overflow],
      DEFAULT_LOOT_FILTER,
      1,
    );
    expect(result.items).toHaveLength(FIELD_BACKPACK_CAP);
    expect(result.kept).toEqual([]);
    expect(result.pendingLootTriage).toEqual({ drop: overflow, queue: [] });
  });

  it("produces a pending triage with the remaining drops queued", () => {
    const currentItems = Array.from({ length: FIELD_BACKPACK_CAP }, (_, i) =>
      makeItem(`existing-${i}`),
    );
    const overflow = makeItem("overflow");
    const queued = makeItem("queued");
    const result = applyLootPickup(
      currentItems,
      [overflow, queued],
      DEFAULT_LOOT_FILTER,
      1,
    );
    expect(result.pendingLootTriage).toEqual({
      drop: overflow,
      queue: [queued],
    });
  });

  it("keeps drops up to the cap before overflowing", () => {
    const currentItems = Array.from(
      { length: FIELD_BACKPACK_CAP - 1 },
      (_, i) => makeItem(`existing-${i}`),
    );
    const fits = makeItem("fits");
    const overflows = makeItem("overflows");
    const result = applyLootPickup(
      currentItems,
      [fits, overflows],
      DEFAULT_LOOT_FILTER,
      1,
    );
    expect(result.items).toHaveLength(FIELD_BACKPACK_CAP);
    expect(result.kept.map((i) => i.instanceId)).toEqual(["fits"]);
    expect(result.pendingLootTriage).toEqual({ drop: overflows, queue: [] });
  });
});

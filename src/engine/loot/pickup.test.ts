import { describe, expect, it } from "vitest";
import { applyLootPickup, queueLootTriage } from "./pickup";
import type { ItemInstance } from "./types";

function makeItem(instanceId: string): ItemInstance {
  return {
    instanceId,
    baseId: "war-blade",
    rarity: "common",
    ilvl: 1,
    prefixes: [],
    suffixes: [],
    implicit: null,
  };
}

describe("applyLootPickup", () => {
  it("accepts every drop when there is room", () => {
    const result = applyLootPickup(
      [makeItem("a")],
      [makeItem("b"), makeItem("c")],
      5,
    );
    expect(result.items.map((i) => i.instanceId)).toEqual(["a", "b", "c"]);
    expect(result.queued).toEqual([]);
  });

  it("fills only the remaining capacity and queues the rest, in order", () => {
    const items = [makeItem("a"), makeItem("b")];
    const drops = [makeItem("c"), makeItem("d"), makeItem("e")];
    const result = applyLootPickup(items, drops, 3);
    expect(result.items.map((i) => i.instanceId)).toEqual(["a", "b", "c"]);
    expect(result.queued.map((i) => i.instanceId)).toEqual(["d", "e"]);
  });

  it("queues every drop when already at cap, never extending items past it", () => {
    const items = [makeItem("a"), makeItem("b"), makeItem("c")];
    const drops = [makeItem("d"), makeItem("e")];
    const result = applyLootPickup(items, drops, 3);
    expect(result.items.map((i) => i.instanceId)).toEqual(["a", "b", "c"]);
    expect(result.queued.map((i) => i.instanceId)).toEqual(["d", "e"]);
  });

  it("never drops loot silently: items.length plus queued.length always equals the input total", () => {
    const items = [makeItem("a")];
    const drops = [makeItem("b"), makeItem("c"), makeItem("d")];
    const result = applyLootPickup(items, drops, 2);
    expect(result.items.length + result.queued.length).toBe(
      items.length + drops.length,
    );
  });
});

describe("queueLootTriage", () => {
  it("returns the existing pending queue unchanged when nothing new is queued", () => {
    const pending = { drops: [makeItem("a")] };
    expect(queueLootTriage(pending, [])).toBe(pending);
  });

  it("starts a fresh queue from null", () => {
    const result = queueLootTriage(null, [makeItem("a"), makeItem("b")]);
    expect(result?.drops.map((i) => i.instanceId)).toEqual(["a", "b"]);
  });

  it("appends onto an existing queue, preserving arrival order", () => {
    const pending = { drops: [makeItem("a")] };
    const result = queueLootTriage(pending, [makeItem("b")]);
    expect(result?.drops.map((i) => i.instanceId)).toEqual(["a", "b"]);
  });
});

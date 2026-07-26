import { describe, expect, it } from "vitest";
import { createStartingHero } from "../../../engine/entities/party";
import { EMPTY_LOOT_FILTER } from "../../../engine/loot/lootFilter";
import type { ItemInstance } from "../../../engine/loot/types";
import { buildPackEntries } from "../village/interaction";
import {
  cycleFilterRow,
  INITIAL_INVENTORY_UI_STATE,
  type InventoryUiContext,
  type InventoryUiState,
  reduceInventoryUi,
  resolveInventoryIntent,
  SORT_KEYS,
  sortPackEntries,
} from "./interaction";

function item(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    instanceId: "item-1",
    baseId: "short-sword",
    rarity: "common",
    ilvl: 1,
    prefixes: [],
    suffixes: [],
    implicit: null,
    ...overrides,
  };
}

function state(overrides: Partial<InventoryUiState> = {}): InventoryUiState {
  return { ...INITIAL_INVENTORY_UI_STATE, ...overrides };
}

function ctx(overrides: Partial<InventoryUiContext> = {}): InventoryUiContext {
  return {
    partyLength: 1,
    memberId: "hero-1",
    packEntries: buildPackEntries(createStartingHero(), []),
    consumables: [],
    lootFilter: EMPTY_LOOT_FILTER,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section (tab) cycling
// ---------------------------------------------------------------------------

describe("resolveInventoryIntent", () => {
  it("gear section binds up/down/left/right/enter/e/u/r", () => {
    expect(resolveInventoryIntent("gear", "up")).toEqual({ kind: "menuUp" });
    expect(resolveInventoryIntent("gear", "down")).toEqual({
      kind: "menuDown",
    });
    expect(resolveInventoryIntent("gear", "left")).toEqual({
      kind: "menuLeft",
    });
    expect(resolveInventoryIntent("gear", "right")).toEqual({
      kind: "menuRight",
    });
    expect(resolveInventoryIntent("gear", "enter")).toEqual({
      kind: "confirm",
    });
    expect(resolveInventoryIntent("gear", "char:e")).toEqual({
      kind: "equip",
    });
    expect(resolveInventoryIntent("gear", "char:u")).toEqual({
      kind: "unequip",
    });
    expect(resolveInventoryIntent("gear", "char:r")).toEqual({
      kind: "cycleSort",
    });
  });

  it("consumables section binds up/down/left/right/u, not gear-only actions", () => {
    expect(resolveInventoryIntent("consumables", "up")).toEqual({
      kind: "menuUp",
    });
    expect(resolveInventoryIntent("consumables", "down")).toEqual({
      kind: "menuDown",
    });
    expect(resolveInventoryIntent("consumables", "left")).toEqual({
      kind: "menuLeft",
    });
    expect(resolveInventoryIntent("consumables", "right")).toEqual({
      kind: "menuRight",
    });
    expect(resolveInventoryIntent("consumables", "char:u")).toEqual({
      kind: "useItem",
    });
    expect(resolveInventoryIntent("consumables", "char:e")).toBeUndefined();
    expect(resolveInventoryIntent("consumables", "char:r")).toBeUndefined();
    expect(resolveInventoryIntent("consumables", "enter")).toBeUndefined();
  });

  it("currency/quest sections only bind escape/tab, no cursor or item actions", () => {
    for (const section of ["currency", "quest"] as const) {
      expect(resolveInventoryIntent(section, "escape")).toEqual({
        kind: "cancel",
      });
      expect(resolveInventoryIntent(section, "tab")).toEqual({
        kind: "switchMode",
      });
      expect(resolveInventoryIntent(section, "char:e")).toBeUndefined();
      expect(resolveInventoryIntent(section, "char:u")).toBeUndefined();
      expect(resolveInventoryIntent(section, "up")).toBeUndefined();
    }
  });

  it("filter section binds up/down/left/right/enter, not item actions", () => {
    expect(resolveInventoryIntent("filter", "up")).toEqual({
      kind: "menuUp",
    });
    expect(resolveInventoryIntent("filter", "down")).toEqual({
      kind: "menuDown",
    });
    expect(resolveInventoryIntent("filter", "left")).toEqual({
      kind: "menuLeft",
    });
    expect(resolveInventoryIntent("filter", "right")).toEqual({
      kind: "menuRight",
    });
    expect(resolveInventoryIntent("filter", "enter")).toEqual({
      kind: "confirm",
    });
    expect(resolveInventoryIntent("filter", "escape")).toEqual({
      kind: "cancel",
    });
    expect(resolveInventoryIntent("filter", "tab")).toEqual({
      kind: "switchMode",
    });
    expect(resolveInventoryIntent("filter", "char:e")).toBeUndefined();
    expect(resolveInventoryIntent("filter", "char:u")).toBeUndefined();
    expect(resolveInventoryIntent("filter", "char:r")).toBeUndefined();
  });
});

describe("reduceInventoryUi - section cycling", () => {
  it("Tab cycles gear -> consumables -> currency -> quest -> filter -> gear", () => {
    let s = state({ section: "gear" });
    s = reduceInventoryUi(s, { kind: "switchMode" }, ctx()).state;
    expect(s.section).toBe("consumables");
    s = reduceInventoryUi(s, { kind: "switchMode" }, ctx()).state;
    expect(s.section).toBe("currency");
    s = reduceInventoryUi(s, { kind: "switchMode" }, ctx()).state;
    expect(s.section).toBe("quest");
    s = reduceInventoryUi(s, { kind: "switchMode" }, ctx()).state;
    expect(s.section).toBe("filter");
    s = reduceInventoryUi(s, { kind: "switchMode" }, ctx()).state;
    expect(s.section).toBe("gear");
  });

  it("resets packCursor, consumableCursor, filterCursor, and inspecting on section switch", () => {
    const result = reduceInventoryUi(
      state({
        section: "gear",
        packCursor: 3,
        consumableCursor: 2,
        filterCursor: 5,
        inspecting: true,
      }),
      { kind: "switchMode" },
      ctx(),
    );
    expect(result.state.packCursor).toBe(0);
    expect(result.state.consumableCursor).toBe(0);
    expect(result.state.filterCursor).toBe(0);
    expect(result.state.inspecting).toBe(false);
  });

  it("Esc emits a back effect from any section", () => {
    for (const section of [
      "gear",
      "consumables",
      "currency",
      "quest",
      "filter",
    ] as const) {
      const result = reduceInventoryUi(
        state({ section }),
        { kind: "cancel" },
        ctx(),
      );
      expect(result.effect).toEqual({ type: "back" });
    }
  });

  it("quest section has no backing entries and ignores gear-only intents", () => {
    const result = reduceInventoryUi(
      state({ section: "quest" }),
      { kind: "menuDown" },
      ctx(),
    );
    expect(result.state.section).toBe("quest");
    expect(result.effect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sort cycling
// ---------------------------------------------------------------------------

describe("sortPackEntries", () => {
  const member = createStartingHero();
  const rareHigh = item({
    instanceId: "rare-hi",
    baseId: "plate-mail",
    rarity: "rare",
    ilvl: 9,
  });
  const commonLow = item({
    instanceId: "common-lo",
    baseId: "rusty-dagger",
    rarity: "common",
    ilvl: 1,
  });
  const magicMid = item({
    instanceId: "magic-mid",
    baseId: "iron-sword",
    rarity: "magic",
    ilvl: 5,
    suffixes: [{ affixId: "of-might", value: 4 }],
  });
  const backpack = [commonLow, rareHigh, magicMid];

  it("cycles through all 4 sort keys", () => {
    expect(SORT_KEYS).toEqual(["rarity", "ilvl", "slot", "value"]);
  });

  it("sorts by rarity, highest first, keeping equipped rows pinned at top", () => {
    const entries = buildPackEntries(member, backpack);
    const sorted = sortPackEntries(entries, "rarity");
    expect(sorted.slice(0, 4).every((e) => e.kind === "equipped")).toBe(true);
    const backpackIds = sorted
      .slice(4)
      .map((e) => (e.kind === "backpack" ? e.item.instanceId : null));
    expect(backpackIds).toEqual(["rare-hi", "magic-mid", "common-lo"]);
  });

  it("sorts by ilvl, highest first", () => {
    const entries = buildPackEntries(member, backpack);
    const sorted = sortPackEntries(entries, "ilvl");
    const backpackIds = sorted
      .slice(4)
      .map((e) => (e.kind === "backpack" ? e.item.instanceId : null));
    expect(backpackIds).toEqual(["rare-hi", "magic-mid", "common-lo"]);
  });

  it("sorts by slot, alphabetically", () => {
    const entries = buildPackEntries(member, backpack);
    const sorted = sortPackEntries(entries, "slot");
    // plate-mail -> "armor", rusty-dagger/iron-sword -> "weapon" (tied
    // weapons keep their relative order: common-lo before magic-mid).
    const backpackIds = sorted
      .slice(4)
      .map((e) => (e.kind === "backpack" ? e.item.instanceId : null));
    expect(backpackIds).toEqual(["rare-hi", "common-lo", "magic-mid"]);
  });

  it("sorts by value, highest first", () => {
    const entries = buildPackEntries(member, backpack);
    const sorted = sortPackEntries(entries, "value");
    const backpackIds = sorted
      .slice(4)
      .map((e) => (e.kind === "backpack" ? e.item.instanceId : null));
    // rare-hi: floor(25*3)=75; magic-mid: floor(12*2)+4=28; common-lo: floor(5*1)=5
    expect(backpackIds).toEqual(["rare-hi", "magic-mid", "common-lo"]);
  });
});

describe("reduceInventoryUi - cycleSort", () => {
  it("cycles sortKey through rarity -> ilvl -> slot -> value -> rarity", () => {
    let s = state({ section: "gear", sortKey: "rarity" });
    s = reduceInventoryUi(s, { kind: "cycleSort" }, ctx()).state;
    expect(s.sortKey).toBe("ilvl");
    s = reduceInventoryUi(s, { kind: "cycleSort" }, ctx()).state;
    expect(s.sortKey).toBe("slot");
    s = reduceInventoryUi(s, { kind: "cycleSort" }, ctx()).state;
    expect(s.sortKey).toBe("value");
    s = reduceInventoryUi(s, { kind: "cycleSort" }, ctx()).state;
    expect(s.sortKey).toBe("rarity");
  });
});

// ---------------------------------------------------------------------------
// Member switching
// ---------------------------------------------------------------------------

describe("reduceInventoryUi - member switching", () => {
  it("Left/Right cycle memberIndex only when party.length > 1, in gear or consumables", () => {
    const single = reduceInventoryUi(
      state({ section: "gear", memberIndex: 0 }),
      { kind: "menuRight" },
      ctx({ partyLength: 1 }),
    );
    expect(single.state.memberIndex).toBe(0);

    const multi = reduceInventoryUi(
      state({ section: "gear", memberIndex: 0 }),
      { kind: "menuRight" },
      ctx({ partyLength: 3 }),
    );
    expect(multi.state.memberIndex).toBe(1);

    const wrap = reduceInventoryUi(
      state({ section: "gear", memberIndex: 0 }),
      { kind: "menuLeft" },
      ctx({ partyLength: 3 }),
    );
    expect(wrap.state.memberIndex).toBe(2);

    const consumables = reduceInventoryUi(
      state({ section: "consumables", memberIndex: 0 }),
      { kind: "menuRight" },
      ctx({ partyLength: 3 }),
    );
    expect(consumables.state.memberIndex).toBe(1);

    const currency = reduceInventoryUi(
      state({ section: "currency", memberIndex: 0 }),
      { kind: "menuRight" },
      ctx({ partyLength: 3 }),
    );
    expect(currency.state.memberIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Inspect
// ---------------------------------------------------------------------------

describe("reduceInventoryUi - inspect", () => {
  it("confirm toggles inspecting on and off", () => {
    const on = reduceInventoryUi(
      state({ section: "gear", inspecting: false }),
      { kind: "confirm" },
      ctx(),
    );
    expect(on.state.inspecting).toBe(true);

    const off = reduceInventoryUi(on.state, { kind: "confirm" }, ctx());
    expect(off.state.inspecting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Equip / unequip
// ---------------------------------------------------------------------------

describe("reduceInventoryUi - equip/unequip", () => {
  it("equips the selected backpack entry", () => {
    const member = createStartingHero();
    const backpackItem = item({ instanceId: "sword-1" });
    const entries = buildPackEntries(member, [backpackItem]);
    const equip = reduceInventoryUi(
      state({ section: "gear", packCursor: 4 }),
      { kind: "equip" },
      ctx({ packEntries: entries, memberId: member.id }),
    );
    expect(equip.effect).toEqual({
      type: "equip",
      instanceId: "sword-1",
      memberId: member.id,
    });
  });

  it("unequips the selected equipped slot even when empty", () => {
    const member = createStartingHero();
    const entries = buildPackEntries(member, []);
    const result = reduceInventoryUi(
      state({ section: "gear", packCursor: 0 }),
      { kind: "unequip" },
      ctx({ packEntries: entries, memberId: member.id }),
    );
    expect(result.effect).toEqual({
      type: "unequip",
      slot: "weapon",
      memberId: member.id,
    });
  });

  it("does not equip an equipped-slot row or unequip a backpack row", () => {
    const member = createStartingHero();
    const backpackItem = item({ instanceId: "sword-1" });
    const entries = buildPackEntries(member, [backpackItem]);
    const ctxHere = ctx({ packEntries: entries, memberId: member.id });

    const noEquip = reduceInventoryUi(
      state({ section: "gear", packCursor: 0 }),
      { kind: "equip" },
      ctxHere,
    );
    expect(noEquip.effect).toBeUndefined();

    const noUnequip = reduceInventoryUi(
      state({ section: "gear", packCursor: 4 }),
      { kind: "unequip" },
      ctxHere,
    );
    expect(noUnequip.effect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Field consumable use (ENG-4)
// ---------------------------------------------------------------------------

describe("reduceInventoryUi - consumables cursor and use", () => {
  const consumables = [
    { itemId: "potion", quantity: 2 },
    { itemId: "hi-potion", quantity: 1 },
  ];

  it("up/down cycle the consumable cursor and wrap", () => {
    let s = state({ section: "consumables", consumableCursor: 0 });
    s = reduceInventoryUi(s, { kind: "menuDown" }, ctx({ consumables })).state;
    expect(s.consumableCursor).toBe(1);
    s = reduceInventoryUi(s, { kind: "menuDown" }, ctx({ consumables })).state;
    expect(s.consumableCursor).toBe(0);
    s = reduceInventoryUi(s, { kind: "menuUp" }, ctx({ consumables })).state;
    expect(s.consumableCursor).toBe(1);
  });

  it("does nothing when there are no consumables", () => {
    const result = reduceInventoryUi(
      state({ section: "consumables", consumableCursor: 0 }),
      { kind: "menuDown" },
      ctx({ consumables: [] }),
    );
    expect(result.state.consumableCursor).toBe(0);
  });

  it("useItem emits an effect for the selected item and current target member", () => {
    const result = reduceInventoryUi(
      state({ section: "consumables", consumableCursor: 1 }),
      { kind: "useItem" },
      ctx({ consumables, memberId: "hero-2" }),
    );
    expect(result.effect).toEqual({
      type: "useItem",
      itemId: "hi-potion",
      memberId: "hero-2",
    });
  });

  it("useItem is a no-op when the consumables list is empty", () => {
    const result = reduceInventoryUi(
      state({ section: "consumables", consumableCursor: 0 }),
      { kind: "useItem" },
      ctx({ consumables: [] }),
    );
    expect(result.effect).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Loot filter settings pane (ENG-19)
// ---------------------------------------------------------------------------

describe("reduceInventoryUi - filter section cursor movement", () => {
  it("up/down cycle the filter cursor wrapping through 8 rows", () => {
    let s = state({ section: "filter", filterCursor: 0 });
    s = reduceInventoryUi(s, { kind: "menuUp" }, ctx()).state;
    expect(s.filterCursor).toBe(7);
    s = reduceInventoryUi(s, { kind: "menuDown" }, ctx()).state;
    expect(s.filterCursor).toBe(0);
    s = reduceInventoryUi(s, { kind: "menuDown" }, ctx()).state;
    expect(s.filterCursor).toBe(1);
    s = reduceInventoryUi(s, { kind: "menuDown" }, ctx()).state;
    expect(s.filterCursor).toBe(2);
  });

  it("filter section ignores gear-only intents like cycleSort", () => {
    const result = reduceInventoryUi(
      state({ section: "filter" }),
      { kind: "cycleSort" },
      ctx(),
    );
    expect(result.effect).toBeUndefined();
    expect(result.state.section).toBe("filter");
  });
});

describe("reduceInventoryUi - filter section value changes", () => {
  it("Enter on a rarity tier row (cursor=0) cycles rarity forward and emits setLootFilter", () => {
    const result = reduceInventoryUi(
      state({ section: "filter", filterCursor: 0 }),
      { kind: "confirm" },
      ctx(),
    );
    expect(result.effect).toBeDefined();
    expect(result.effect!.type).toBe("setLootFilter");
    const rules = (result.effect as { type: "setLootFilter"; rules: unknown })
      .rules;
    // Starting from empty (no floor -> undefined), cycle forward -> "common"
    expect(rules).toHaveProperty("minRarityByTier");
    expect(
      (rules as { minRarityByTier: Record<number, string> }).minRarityByTier[1],
    ).toBe("common");
  });

  it("Enter on a rarity tier row (cursor=1) cycles rarity forward and emits setLootFilter", () => {
    const result = reduceInventoryUi(
      state({ section: "filter", filterCursor: 1 }),
      { kind: "confirm" },
      ctx(),
    );
    const rules = (result.effect as { type: "setLootFilter"; rules: unknown })
      .rules;
    expect(
      (rules as { minRarityByTier: Record<number, string> }).minRarityByTier[2],
    ).toBe("common");
  });

  it("Enter on an affix toggle row (cursor=4) toggles stat ON and emits setLootFilter", () => {
    const result = reduceInventoryUi(
      state({ section: "filter", filterCursor: 4 }),
      { kind: "confirm" },
      ctx(),
    );
    const rules = (
      result.effect as {
        type: "setLootFilter";
        rules: { keepAffixStats: string[] };
      }
    ).rules;
    expect(rules.keepAffixStats).toEqual(["str"]);
  });

  it("Enter again on same affix row toggles stat OFF", () => {
    const ctxWithStr = ctx({
      lootFilter: { minRarityByTier: {}, keepAffixStats: ["str"] },
    });
    const result = reduceInventoryUi(
      state({ section: "filter", filterCursor: 4 }),
      { kind: "confirm" },
      ctxWithStr,
    );
    const rules = (
      result.effect as {
        type: "setLootFilter";
        rules: { keepAffixStats: string[] };
      }
    ).rules;
    expect(rules.keepAffixStats).toEqual([]);
  });

  it("Left on a ilvl offset row (cursor=3) cycles back and emits setLootFilter", () => {
    const ctxWithOffset = ctx({
      lootFilter: { minRarityByTier: {}, minIlvlOffset: 0, keepAffixStats: [] },
    });
    const result = reduceInventoryUi(
      state({ section: "filter", filterCursor: 3 }),
      { kind: "menuLeft" },
      ctxWithOffset,
    );
    const rules = (
      result.effect as {
        type: "setLootFilter";
        rules: { minIlvlOffset: number | undefined };
      }
    ).rules;
    // Starting from 0, cycle back -> -3 (since array is [undefined, -5, -3, 0, 3, 5, 10])
    expect(rules.minIlvlOffset).toBe(-3);
  });

  it("Right on default empty filter cycles rarity forward for tier 1 and emits setLootFilter", () => {
    const result = reduceInventoryUi(
      state({ section: "filter", filterCursor: 0 }),
      { kind: "menuRight" },
      ctx(),
    );
    const rules = (
      result.effect as {
        type: "setLootFilter";
        rules: { minRarityByTier: Record<number, string> };
      }
    ).rules;
    expect(rules.minRarityByTier[1]).toBe("common");
  });
});

describe("cycleFilterRow", () => {
  it("returns a new object, not mutating the original", () => {
    const original = EMPTY_LOOT_FILTER;
    const result = cycleFilterRow(original, 4, 1);
    expect(result).not.toBe(original);
    expect(original.keepAffixStats).toEqual([]);
  });

  it("cycles tier 1 rarity from undefined -> common -> magic -> rare -> unique -> undefined", () => {
    const base = EMPTY_LOOT_FILTER;
    const step1 = cycleFilterRow(base, 0, 1);
    expect(step1.minRarityByTier[1]).toBe("common");
    const step2 = cycleFilterRow(step1, 0, 1);
    expect(step2.minRarityByTier[1]).toBe("magic");
    const step3 = cycleFilterRow(step2, 0, 1);
    expect(step3.minRarityByTier[1]).toBe("rare");
    const step4 = cycleFilterRow(step3, 0, 1);
    expect(step4.minRarityByTier[1]).toBe("unique");
    const step5 = cycleFilterRow(step4, 0, 1);
    expect(step5.minRarityByTier[1]).toBeUndefined();
  });

  it("cycles ilvl offset from undefined -> -5 -> -3 -> 0 -> 3 -> 5 -> 10 -> undefined", () => {
    const base = EMPTY_LOOT_FILTER;
    const step1 = cycleFilterRow(base, 3, 1);
    expect(step1.minIlvlOffset).toBe(-5);
    const step2 = cycleFilterRow(step1, 3, 1);
    expect(step2.minIlvlOffset).toBe(-3);
    const step3 = cycleFilterRow(step2, 3, 1);
    expect(step3.minIlvlOffset).toBe(0);
    const step4 = cycleFilterRow(step3, 3, 1);
    expect(step4.minIlvlOffset).toBe(3);
    const step5 = cycleFilterRow(step4, 3, 1);
    expect(step5.minIlvlOffset).toBe(5);
    const step6 = cycleFilterRow(step5, 3, 1);
    expect(step6.minIlvlOffset).toBe(10);
    const step7 = cycleFilterRow(step6, 3, 1);
    expect(step7.minIlvlOffset).toBeUndefined();
  });

  it("toggles affix stat on and off", () => {
    const base = EMPTY_LOOT_FILTER;
    const on = cycleFilterRow(base, 4, 1);
    expect(on.keepAffixStats).toEqual(["str"]);
    const off = cycleFilterRow(on, 4, 1);
    expect(off.keepAffixStats).toEqual([]);
  });

  it("toggles a different affix stat without affecting others", () => {
    const base = EMPTY_LOOT_FILTER;
    const onStr = cycleFilterRow(base, 4, 1);
    const onStrAgi = cycleFilterRow(onStr, 5, 1);
    expect(onStrAgi.keepAffixStats).toEqual(["str", "agi"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  createStartingHero,
  type PartyMember,
} from "../../../engine/entities/party";
import type { ItemInstance } from "../../../engine/loot/types";
import {
  buildStatRows,
  INITIAL_CHARACTER_UI_STATE,
  reduceCharacterUi,
  resolveCharacterIntent,
} from "./interaction";

const STR_SWORD: ItemInstance = {
  instanceId: "itm-w",
  baseId: "war-blade",
  rarity: "rare",
  ilvl: 10,
  prefixes: [],
  suffixes: [],
  implicit: null,
};

function heroWith(equipment: Partial<PartyMember["equipment"]>): PartyMember {
  const hero = createStartingHero();
  return { ...hero, equipment: { ...hero.equipment, ...equipment } };
}

describe("resolveCharacterIntent", () => {
  it("maps left/right to menuLeft/menuRight and escape to cancel", () => {
    expect(resolveCharacterIntent("left")).toEqual({ kind: "menuLeft" });
    expect(resolveCharacterIntent("right")).toEqual({ kind: "menuRight" });
    expect(resolveCharacterIntent("escape")).toEqual({ kind: "cancel" });
  });

  it("ignores unbound keys", () => {
    expect(resolveCharacterIntent("tab")).toBeUndefined();
    expect(resolveCharacterIntent("char:c")).toBeUndefined();
  });
});

describe("reduceCharacterUi", () => {
  it("cancel emits a back effect and leaves state untouched", () => {
    const result = reduceCharacterUi(
      INITIAL_CHARACTER_UI_STATE,
      { kind: "cancel" },
      { partyLength: 1 },
    );
    expect(result.effect).toEqual({ type: "back" });
    expect(result.state).toEqual(INITIAL_CHARACTER_UI_STATE);
  });

  it("wraps the member index with menuLeft/menuRight when the party has more than one member", () => {
    const ctx = { partyLength: 3 };
    expect(
      reduceCharacterUi({ memberIndex: 0 }, { kind: "menuLeft" }, ctx).state,
    ).toEqual({ memberIndex: 2 });
    expect(
      reduceCharacterUi({ memberIndex: 2 }, { kind: "menuRight" }, ctx).state,
    ).toEqual({ memberIndex: 0 });
  });

  it("ignores menuLeft/menuRight for a solo party", () => {
    const result = reduceCharacterUi(
      { memberIndex: 0 },
      { kind: "menuRight" },
      { partyLength: 1 },
    );
    expect(result.state).toEqual({ memberIndex: 0 });
    expect(result.effect).toBeUndefined();
  });

  it("is a no-op for an unrelated intent", () => {
    const result = reduceCharacterUi(
      { memberIndex: 0 },
      { kind: "toggleConsole" },
      { partyLength: 1 },
    );
    expect(result.state).toEqual({ memberIndex: 0 });
    expect(result.effect).toBeUndefined();
  });
});

describe("buildStatRows", () => {
  it("reports base stats with zero bonus and matching total when unequipped", () => {
    const hero = createStartingHero();
    expect(buildStatRows(hero)).toEqual([
      { key: "str", label: "STR", base: 7, bonus: 0, total: 7 },
      { key: "agi", label: "AGI", base: 4, bonus: 0, total: 4 },
      { key: "vit", label: "VIT", base: 7, bonus: 0, total: 7 },
      { key: "int", label: "INT", base: 2, bonus: 0, total: 2 },
    ]);
  });

  it("splits out the equipment bonus per stat", () => {
    const hero = heroWith({ weapon: STR_SWORD });
    const strRow = buildStatRows(hero).find((row) => row.key === "str");
    expect(strRow?.base).toBe(7);
    expect(strRow?.bonus).toBeGreaterThan(0);
    expect(strRow?.total).toBe((strRow?.base ?? 0) + (strRow?.bonus ?? 0));
  });
});

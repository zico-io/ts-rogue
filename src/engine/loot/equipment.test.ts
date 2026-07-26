import { describe, expect, it } from "vitest";
import { createStartingHero, type PartyMember } from "../entities/party";
import { compareItem, effectiveStats, equipTargetSlot } from "./equipment";
import type { ItemInstance } from "./types";

const STR_SWORD: ItemInstance = {
  instanceId: "itm-w",
  baseId: "war-blade",
  rarity: "rare",
  ilvl: 10,
  prefixes: [],
  suffixes: [],
  implicit: null,
};
const VIT_ARMOR: ItemInstance = {
  instanceId: "itm-a",
  baseId: "plate-mail",
  rarity: "rare",
  ilvl: 10,
  prefixes: [],
  suffixes: [],
  implicit: null,
};
const AGI_RING: ItemInstance = {
  instanceId: "itm-r1",
  baseId: "copper-ring",
  rarity: "magic",
  ilvl: 1,
  prefixes: [],
  suffixes: [],
  implicit: null,
};
const AGI_RING_2: ItemInstance = { ...AGI_RING, instanceId: "itm-r2" };

function heroWith(equipment: Partial<PartyMember["equipment"]>): PartyMember {
  return {
    ...createStartingHero(),
    equipment: { ...createStartingHero().equipment, ...equipment },
  };
}

describe("effectiveStats", () => {
  it("equals base stats with no equipment", () => {
    expect(effectiveStats(createStartingHero())).toEqual({
      str: 7,
      agi: 4,
      vit: 7,
      int: 2,
    });
  });

  it("adds every equipped item's stat bonus", () => {
    const hero = heroWith({
      weapon: STR_SWORD,
      armor: VIT_ARMOR,
      accessory1: AGI_RING,
    });

    expect(effectiveStats(hero)).toEqual({ str: 12, agi: 5, vit: 12, int: 2 });
  });
});

describe("equipTargetSlot", () => {
  it("maps weapons and armor to their fixed slots", () => {
    const hero = createStartingHero();
    expect(equipTargetSlot(hero, STR_SWORD)).toBe("weapon");
    expect(equipTargetSlot(hero, VIT_ARMOR)).toBe("armor");
  });

  it("fills the first empty accessory slot, then swaps accessory1 when both are full", () => {
    expect(equipTargetSlot(createStartingHero(), AGI_RING)).toBe("accessory1");
    const oneFilled = heroWith({ accessory1: AGI_RING });
    expect(equipTargetSlot(oneFilled, AGI_RING_2)).toBe("accessory2");
    const bothFilled = heroWith({
      accessory1: AGI_RING,
      accessory2: AGI_RING_2,
    });
    expect(equipTargetSlot(bothFilled, AGI_RING)).toBe("accessory1");
  });
});

describe("compareItem", () => {
  it("shows the full bonus versus an empty slot", () => {
    expect(compareItem(createStartingHero(), STR_SWORD)).toEqual({
      str: 5,
      agi: 0,
      vit: 0,
      int: 0,
    });
  });

  it("shows the net delta versus the currently equipped item in the target slot", () => {
    const hero = heroWith({ weapon: STR_SWORD });
    const better: ItemInstance = {
      instanceId: "itm-w2",
      baseId: "war-blade",
      rarity: "unique",
      ilvl: 12,
      prefixes: [{ affixId: "vicious", value: 5 }],
      suffixes: [],
      implicit: null,
    };

    expect(compareItem(hero, better)).toEqual({
      str: 5,
      agi: 0,
      vit: 0,
      int: 0,
    });
  });
});

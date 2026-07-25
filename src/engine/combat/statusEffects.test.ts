import { describe, expect, it } from "vitest";
import { findStatusEffect, STATUS_EFFECTS } from "./statusEffects";

describe("STATUS_EFFECTS data table", () => {
  it("resolves all nine status effect ids via findStatusEffect", () => {
    const ids = [
      "poison",
      "burn",
      "stun",
      "slow",
      "wet",
      "oiled",
      "chilled",
      "frozen",
      "shocked",
    ];
    expect(STATUS_EFFECTS.map((effect) => effect.id).sort()).toEqual(
      [...ids].sort(),
    );
    for (const id of ids) {
      expect(findStatusEffect(id)?.id).toBe(id);
    }
  });

  it("returns undefined for an unknown effect id", () => {
    expect(findStatusEffect("nope")).toBeUndefined();
  });
});

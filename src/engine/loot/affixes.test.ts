import { describe, expect, it } from "vitest";
import { findAffix } from "../../data/affixes";
import { Rng } from "../rng/rng";
import {
  eligibleAffixes,
  RARITY_AFFIX_CAPS,
  rollAffixes,
  rollImplicitAffix,
} from "./affixes";
import type { Rarity } from "./types";

describe("RARITY_AFFIX_CAPS", () => {
  it("gives common no affixes, magic 1/1, and rare/unique up to 3/3", () => {
    expect(RARITY_AFFIX_CAPS.common).toEqual({ prefix: 0, suffix: 0 });
    expect(RARITY_AFFIX_CAPS.magic).toEqual({ prefix: 1, suffix: 1 });
    expect(RARITY_AFFIX_CAPS.rare).toEqual({ prefix: 3, suffix: 3 });
    expect(RARITY_AFFIX_CAPS.unique).toEqual({ prefix: 3, suffix: 3 });
  });
});

describe("eligibleAffixes", () => {
  it("returns only ilvl-1 prefixes for an ilvl-1 item, excluding signature affixes", () => {
    expect(eligibleAffixes(1, "prefix").map((a) => a.id)).toEqual([
      "brute",
      "nimble",
      "sturdy",
      "clever",
    ]);
  });

  it("unlocks the ilvl-8 prefixes at ilvl 8", () => {
    expect(eligibleAffixes(8, "prefix").map((a) => a.id)).toEqual([
      "brute",
      "vicious",
      "nimble",
      "swift",
      "sturdy",
      "tough",
      "clever",
      "sage",
    ]);
  });

  it("never offers signature (sig-) affixes for rolling", () => {
    for (const kind of ["prefix", "suffix"] as const) {
      for (let ilvl = 1; ilvl <= 20; ilvl++) {
        for (const affix of eligibleAffixes(ilvl, kind)) {
          expect(affix.id.startsWith("sig-")).toBe(false);
        }
      }
    }
  });
});

describe("rollAffixes", () => {
  it("is deterministic for a fixed seed", () => {
    const runOnce = () => rollAffixes(new Rng(11), 12, "rare");
    expect(runOnce()).toEqual(runOnce());
  });

  it("rolls exact affixes for rare ilvl-12 seed 11", () => {
    expect(rollAffixes(new Rng(11), 12, "rare")).toEqual({
      prefixes: [{ affixId: "brute", value: 2 }],
      suffixes: [
        { affixId: "of-sorcery", value: 3 },
        { affixId: "of-might", value: 4 },
        { affixId: "of-the-titan", value: 5 },
      ],
    });
  });

  it("rolls one prefix and one suffix for magic ilvl-1 seed 7", () => {
    expect(rollAffixes(new Rng(7), 1, "magic")).toEqual({
      prefixes: [{ affixId: "nimble", value: 1 }],
      suffixes: [{ affixId: "of-evasion", value: 2 }],
    });
  });

  it("rolls no affixes for common", () => {
    expect(rollAffixes(new Rng(7), 1, "common")).toEqual({
      prefixes: [],
      suffixes: [],
    });
  });

  it("keeps counts within rarity caps, values within range, and affixes distinct and ilvl-gated", () => {
    const rarities: Rarity[] = ["common", "magic", "rare", "unique"];
    for (let seed = 1; seed <= 200; seed++) {
      for (const rarity of rarities) {
        const ilvl = 12;
        const { prefixes, suffixes } = rollAffixes(new Rng(seed), ilvl, rarity);
        const cap = RARITY_AFFIX_CAPS[rarity];
        expect(prefixes.length).toBeLessThanOrEqual(cap.prefix);
        expect(suffixes.length).toBeLessThanOrEqual(cap.suffix);
        if (rarity === "common") {
          expect(prefixes).toHaveLength(0);
          expect(suffixes).toHaveLength(0);
        }
        const ids = new Set<string>();
        for (const affix of [...prefixes, ...suffixes]) {
          const def = findAffix(affix.affixId);
          expect(def).toBeDefined();
          expect(affix.value).toBeGreaterThanOrEqual(def?.min ?? NaN);
          expect(affix.value).toBeLessThanOrEqual(def?.max ?? NaN);
          expect(def?.ilvl).toBeLessThanOrEqual(ilvl);
          expect(def?.id.startsWith("sig-")).toBe(false);
          expect(ids.has(def?.id ?? "")).toBe(false);
          ids.add(def?.id ?? "");
        }
      }
    }
  });
});

describe("rollImplicitAffix", () => {
  it("always uses the given signature id and rolls within its range", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rolled = rollImplicitAffix(new Rng(seed), "sig-warding");
      expect(rolled.affixId).toBe("sig-warding");
      expect(rolled.value).toBeGreaterThanOrEqual(6);
      expect(rolled.value).toBeLessThanOrEqual(10);
    }
    expect(rollImplicitAffix(new Rng(1), "sig-warding")).toEqual(
      rollImplicitAffix(new Rng(1), "sig-warding"),
    );
  });
});

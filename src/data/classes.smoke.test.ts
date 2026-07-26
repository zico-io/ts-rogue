import { describe, expect, it } from "vitest";
import { grantXp } from "../engine/combat/resolution";
import { createStartingHero } from "../engine/entities/party";
import { newGame, reduce } from "../engine/state/store";
import { deserialize, serialize } from "../persistence/save";
import { CLASSES, DEFAULT_CLASS_ID } from "./classes";

describe("ROG-17 character classes - end-to-end smoke", () => {
  it("ships exactly three classes; iterating CLASSES drives every assertion", () => {
    expect(CLASSES).toHaveLength(3);
  });

  it("each class starts with a distinct stat block, HP/MP, and skill id set", () => {
    const statBlocks = CLASSES.map(
      (cls) =>
        `${cls.stats.str}/${cls.stats.agi}/${cls.stats.vit}/${cls.stats.int}`,
    );
    expect(new Set(statBlocks).size).toBe(CLASSES.length);

    const hpMp = CLASSES.map((cls) => `${cls.maxHp}/${cls.maxMp}`);
    expect(new Set(hpMp).size).toBe(CLASSES.length);

    const skillSets = CLASSES.map((cls) => [...cls.skills].sort().join(","));
    expect(new Set(skillSets).size).toBe(CLASSES.length);
  });

  it("per-class leveling diverges by class identity through the real grantXp path", () => {
    const warrior = grantXp(createStartingHero("warrior"), 80);
    const rogue = grantXp(createStartingHero("rogue"), 80);
    const wizard = grantXp(createStartingHero("wizard"), 80);

    for (const result of [warrior, rogue, wizard]) {
      expect(result.leveledUp).toBe(true);
      expect(result.member.level).toBeGreaterThan(1);
    }

    expect(warrior.member.maxHp).toBeGreaterThan(wizard.member.maxHp);
    expect(wizard.member.maxMp).toBeGreaterThan(warrior.member.maxMp);

    expect(rogue.member.stats.agi).toBeGreaterThan(warrior.member.stats.agi);
    expect(rogue.member.stats.agi).toBeGreaterThan(wizard.member.stats.agi);

    expect(
      new Set([warrior, rogue, wizard].map((r) => r.member.maxHp)).size,
    ).toBe(CLASSES.length);
    expect(
      new Set([warrior, rogue, wizard].map((r) => r.member.maxMp)).size,
    ).toBe(CLASSES.length);
  });

  it("newGame via the reducer wires the chosen classId through to the starting hero", () => {
    for (const cls of CLASSES) {
      const state = reduce(newGame(1), {
        type: "NewGame",
        seed: 42,
        classId: cls.id,
      });
      const hero = state.party[0];
      expect(hero.classId).toBe(cls.id);

      expect(hero.stats).toEqual(cls.stats);
      expect(hero.maxHp).toBe(cls.maxHp);
      expect(hero.maxMp).toBe(cls.maxMp);
    }
  });

  it("loads an old save with no classId as the default class (warrior), cleanly", () => {
    const modern = newGame(42, { classId: "wizard" });
    const older = {
      ...modern,
      party: [{ ...modern.party[0], classId: undefined }],
    };
    const restored = deserialize(JSON.stringify(older));

    expect(restored.party[0].classId).toBe(DEFAULT_CLASS_ID);
    expect(restored.party[0].classId).toBe("warrior");

    expect(restored).toEqual({
      ...modern,
      party: [{ ...modern.party[0], classId: DEFAULT_CLASS_ID }],
    });

    expect(grantXp(restored.party[0], 80).leveledUp).toBe(true);
  });

  it("serialize/deserialize round-trips a freshly created hero stably (deep-equal and byte-identical)", () => {
    for (const cls of CLASSES) {
      const state = newGame(7, { classId: cls.id });
      const hero = createStartingHero(cls.id);

      expect(deserialize(serialize(state)).party[0]).toEqual(hero);
      expect(deserialize(serialize(state))).toEqual(state);

      expect(serialize(state)).toBe(serialize(newGame(7, { classId: cls.id })));
    }
  });
});

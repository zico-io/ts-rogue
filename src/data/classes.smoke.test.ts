/**
 * End-to-end functional smoke for ROG-17 (character classes). This persists
 * the ad-hoc smoke that was originally run inline through `tsx` and never
 * saved as a file. It wires the real data table, hero factory, store/reducer,
 * combat growth, and persistence layers together - no UI, no mocks - so the
 * class system stays covered end to end under `pnpm check` / vitest.
 *
 * Relationships are asserted (not fragile exact numbers) except where a
 * concrete count is the contract. Starting-stat and distinctness expectations
 * are derived from the CLASSES table, so the test stays meaningful as class
 * data changes; the leveling and default-class contracts lock behavior.
 */
import { describe, expect, it } from "vitest";
import { grantXp } from "../engine/combat/resolution";
import { createStartingHero } from "../engine/entities/party";
import { newGame, reduce } from "../engine/state/store";
import { deserialize, serialize } from "../persistence/save";
import { CLASSES, DEFAULT_CLASS_ID } from "./classes";

describe("ROG-17 character classes - end-to-end smoke", () => {
  it("ships exactly three classes; iterating CLASSES drives every assertion", () => {
    expect(CLASSES).toHaveLength(3);
    // A 4th class added without updating this suite fails the length check
    // above instead of silently passing the distinctness checks below.
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
    // 80 XP carries each hero from level 1 to level 4 (three level-ups).
    const warrior = grantXp(createStartingHero("warrior"), 80);
    const rogue = grantXp(createStartingHero("rogue"), 80);
    const wizard = grantXp(createStartingHero("wizard"), 80);

    // Precondition: every class actually leveled up.
    for (const result of [warrior, rogue, wizard]) {
      expect(result.leveledUp).toBe(true);
      expect(result.member.level).toBeGreaterThan(1);
    }

    // Warrior ends with more HP than Wizard; Wizard ends with more MP.
    expect(warrior.member.maxHp).toBeGreaterThan(wizard.member.maxHp);
    expect(wizard.member.maxMp).toBeGreaterThan(warrior.member.maxMp);
    // Rogue leans AGI: highest agility of the three after leveling.
    expect(rogue.member.stats.agi).toBeGreaterThan(warrior.member.stats.agi);
    expect(rogue.member.stats.agi).toBeGreaterThan(wizard.member.stats.agi);
    // Post-level HP and MP diverge meaningfully per class identity.
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
      // The hero is built from the class definition, not hardcoded values.
      expect(hero.stats).toEqual(cls.stats);
      expect(hero.maxHp).toBe(cls.maxHp);
      expect(hero.maxMp).toBe(cls.maxMp);
    }
  });

  it("loads an old save with no classId as the default class (warrior), cleanly", () => {
    // Source save is a wizard run; stripping classId simulates a pre-ROG-17 save.
    const modern = newGame(42, { classId: "wizard" });
    const older = {
      ...modern,
      party: [{ ...modern.party[0], classId: undefined }],
    };
    const restored = deserialize(JSON.stringify(older));

    // Backfill defaults the missing classId to the default class (warrior).
    expect(restored.party[0].classId).toBe(DEFAULT_CLASS_ID);
    expect(restored.party[0].classId).toBe("warrior");
    // Everything else is preserved exactly - only classId was backfilled.
    expect(restored).toEqual({
      ...modern,
      party: [{ ...modern.party[0], classId: DEFAULT_CLASS_ID }],
    });
    // The restored hero is a valid, levelable PartyMember the engine accepts.
    expect(grantXp(restored.party[0], 80).leveledUp).toBe(true);
  });

  it("serialize/deserialize round-trips a freshly created hero stably (deep-equal and byte-identical)", () => {
    for (const cls of CLASSES) {
      const state = newGame(7, { classId: cls.id });
      const hero = createStartingHero(cls.id);
      // Deep-equal: the freshly created hero survives a round-trip.
      expect(deserialize(serialize(state)).party[0]).toEqual(hero);
      expect(deserialize(serialize(state))).toEqual(state);
      // Byte-identical JSON, matching the repo's reproducibility style.
      expect(serialize(state)).toBe(serialize(newGame(7, { classId: cls.id })));
    }
  });
});

import { describe, expect, it } from "vitest";
import { grantXp } from "../engine/combat/resolution";
import { classSkills } from "../engine/combat/skills";
import { createStartingHero } from "../engine/entities/party";
import { CLASSES, DEFAULT_CLASS_ID, findClass } from "./classes";

describe("CLASSES data table", () => {
  it("ships the Warrior, Rogue, and Wizard classes", () => {
    expect(CLASSES.map((cls) => cls.id)).toEqual([
      "warrior",
      "rogue",
      "wizard",
    ]);
  });

  it("exposes findClass and a default class id that resolves", () => {
    expect(findClass("warrior")?.name).toBe("Warrior");
    expect(findClass("rogue")?.name).toBe("Rogue");
    expect(findClass("wizard")?.name).toBe("Wizard");
    expect(findClass("nope")).toBeUndefined();
    expect(findClass(DEFAULT_CLASS_ID)).toBeDefined();
  });

  it("each class has distinct starting stats, HP/MP, and growth", () => {
    const stats = CLASSES.map(
      (cls) =>
        `${cls.stats.str}/${cls.stats.agi}/${cls.stats.vit}/${cls.stats.int}`,
    );
    expect(new Set(stats).size).toBe(CLASSES.length);
    const hpMp = CLASSES.map((cls) => `${cls.maxHp}/${cls.maxMp}`);
    expect(new Set(hpMp).size).toBe(CLASSES.length);
    const growth = CLASSES.map(
      (cls) =>
        `${cls.growth.hp}/${cls.growth.mp}/${cls.growth.str}/${cls.growth.agi}/${cls.growth.vit}/${cls.growth.int}`,
    );
    expect(new Set(growth).size).toBe(CLASSES.length);
  });

  it("Warrior leans on str/vit, Rogue on agi, Wizard on int", () => {
    const warrior = findClass("warrior");
    const rogue = findClass("rogue");
    const wizard = findClass("wizard");
    expect(warrior?.stats.str).toBeGreaterThan(warrior?.stats.int as number);
    expect(warrior?.stats.vit).toBeGreaterThan(warrior?.stats.int as number);
    expect(rogue?.stats.agi).toBeGreaterThan(rogue?.stats.str as number);
    expect(wizard?.stats.int).toBeGreaterThan(wizard?.stats.str as number);
  });

  it("every class lists at least one known skill id", () => {
    for (const cls of CLASSES) {
      expect(cls.skills.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("the three classes have distinct starting skill sets", () => {
    const sets = CLASSES.map((cls) => cls.skills.slice().sort().join(","));
    expect(new Set(sets).size).toBe(CLASSES.length);
  });
});

describe("createStartingHero", () => {
  it("defaults to the default class (warrior) when no classId is given", () => {
    const hero = createStartingHero();
    expect(hero.classId).toBe(DEFAULT_CLASS_ID);
    expect(hero.classId).toBe("warrior");
  });

  it("builds starting stats/HP/MP from the ClassDef", () => {
    const wizard = findClass("wizard");
    const hero = createStartingHero("wizard");
    expect(hero.classId).toBe("wizard");
    expect(hero.stats).toEqual(wizard?.stats);
    expect(hero.maxHp).toBe(wizard?.maxHp);
    expect(hero.maxMp).toBe(wizard?.maxMp);
    expect(hero.hp).toBe(wizard?.maxHp);
    expect(hero.mp).toBe(wizard?.maxMp);
  });

  it("falls back to the default class for an unknown classId", () => {
    const hero = createStartingHero("does-not-exist");
    expect(hero.classId).toBe(DEFAULT_CLASS_ID);
  });

  it("the three classes start with different stats and HP/MP", () => {
    const warrior = createStartingHero("warrior");
    const rogue = createStartingHero("rogue");
    const wizard = createStartingHero("wizard");
    expect(warrior.stats).not.toEqual(rogue.stats);
    expect(rogue.stats).not.toEqual(wizard.stats);
    expect(warrior.maxHp).not.toBe(rogue.maxHp);
    expect(wizard.maxMp).toBeGreaterThan(warrior.maxMp);
  });
});

describe("per-class growth (grantXp)", () => {
  it("Warrior gains more HP per level than Wizard; Wizard gains more MP", () => {
    const warrior = grantXp(createStartingHero("warrior"), 1000);
    const wizard = grantXp(createStartingHero("wizard"), 1000);
    expect(warrior.member.maxHp).toBeGreaterThan(wizard.member.maxHp);
    expect(wizard.member.maxMp).toBeGreaterThan(warrior.member.maxMp);
  });

  it("each class raises a different primary stat the most over levels", () => {
    const warrior = grantXp(createStartingHero("warrior"), 1000).member;
    const rogue = grantXp(createStartingHero("rogue"), 1000).member;
    const wizard = grantXp(createStartingHero("wizard"), 1000).member;
    expect(warrior.stats.str).toBeGreaterThan(rogue.stats.str);
    expect(warrior.stats.str).toBeGreaterThan(wizard.stats.str);
    expect(rogue.stats.agi).toBeGreaterThan(warrior.stats.agi);
    expect(rogue.stats.agi).toBeGreaterThan(wizard.stats.agi);
    expect(wizard.stats.int).toBeGreaterThan(warrior.stats.int);
    expect(wizard.stats.int).toBeGreaterThan(rogue.stats.int);
  });

  it("a hero with no classId (old save shape) levels with the default growth", () => {
    const hero = { ...createStartingHero(), classId: "" };
    const result = grantXp(hero, 1000);
    const control = grantXp(createStartingHero(DEFAULT_CLASS_ID), 1000);
    expect(result.member.stats).toEqual(control.member.stats);
    expect(result.member.maxHp).toBe(control.member.maxHp);
  });
});

describe("classSkills", () => {
  it("returns the SkillDefs for the class starting skills, in order", () => {
    expect(classSkills("warrior").map((s) => s.id)).toEqual([
      "cleave",
      "second-wind",
    ]);
    expect(classSkills("rogue").map((s) => s.id)).toEqual([
      "backstab",
      "pinpoint",
    ]);
    expect(classSkills("wizard").map((s) => s.id)).toEqual([
      "flame",
      "heal",
      "frost",
    ]);
  });

  it("returns an empty list for an unknown class", () => {
    expect(classSkills("nope")).toEqual([]);
  });

  it("every class skill id resolves to a SkillDef", () => {
    for (const cls of CLASSES) {
      const skills = classSkills(cls.id);
      for (const id of cls.skills) {
        expect(skills.find((s) => s.id === id)).toBeDefined();
      }
    }
  });

  it("class skills scale off the class's primary stat; legacy spells default to int", () => {
    const cleave = classSkills("warrior").find((s) => s.id === "cleave");
    expect(cleave?.stat).toBe("str");
    const backstab = classSkills("rogue").find((s) => s.id === "backstab");
    expect(backstab?.stat).toBe("agi");
    const frost = classSkills("wizard").find((s) => s.id === "frost");
    expect(frost?.stat).toBe("int");
    // Legacy Flame/Heal omit stat and default to int.
    const flame = classSkills("wizard").find((s) => s.id === "flame");
    expect(flame?.stat).toBeUndefined();
  });
});

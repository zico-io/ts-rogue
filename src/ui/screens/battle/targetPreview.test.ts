import { describe, expect, it } from "vitest";
import type { SkillDef } from "../../../engine/combat/skills";
import type { BattleEnemy } from "../../../engine/combat/types";
import { battleHighlight, previewSkillTargets } from "./targetPreview";

function makeEnemy(
  id: string,
  hp: number,
  row: "front" | "back" = "front",
): BattleEnemy {
  return {
    id,
    defId: id,
    name: id,
    hp,
    maxHp: 12,
    stats: { str: 1, agi: 1, vit: 1, int: 1 },
    ascii: ["x"],
    xp: 1,
    gold: 1,
    row,
  };
}

const rowSkill: SkillDef = {
  id: "hailstorm",
  name: "Hailstorm",
  mpCost: 9,
  kind: "attack",
  power: 10,
  target: "row",
};

const columnSkill: SkillDef = {
  id: "skewer",
  name: "Skewer",
  mpCost: 6,
  kind: "attack",
  power: 7,
  target: "column",
};

const blastSkill: SkillDef = {
  id: "meteor",
  name: "Meteor",
  mpCost: 12,
  kind: "attack",
  power: 9,
  target: "allEnemies",
};

const scatterSkill: SkillDef = {
  id: "scattershot",
  name: "Scattershot",
  mpCost: 8,
  kind: "attack",
  power: 4,
  target: "randomN",
  hitCount: 2,
};

const singleSkill: SkillDef = {
  id: "flame",
  name: "Flame",
  mpCost: 3,
  kind: "attack",
  power: 8,
  target: "single",
};

// Two-row encounter: front-1/front-2 in front, back-1/back-2 in back, each
// pair sharing a lane index (front-1/back-1, front-2/back-2).
function twoRowEncounter(): BattleEnemy[] {
  return [
    makeEnemy("front-1", 10, "front"),
    makeEnemy("front-2", 10, "front"),
    makeEnemy("back-1", 10, "back"),
    makeEnemy("back-2", 10, "back"),
  ];
}

describe("previewSkillTargets", () => {
  it("highlights exactly the anchor's row for a row shape", () => {
    const preview = previewSkillTargets(rowSkill, twoRowEncounter(), "back-2");
    expect(new Set(preview.targetIds)).toEqual(new Set(["back-1", "back-2"]));
    expect(preview.indicator).toBe("Hits the whole row");
  });

  it("highlights one enemy per row along the anchor's lane for a column shape", () => {
    const preview = previewSkillTargets(
      columnSkill,
      twoRowEncounter(),
      "front-2",
    );
    expect(new Set(preview.targetIds)).toEqual(new Set(["front-2", "back-2"]));
    expect(preview.indicator).toBe("Hits this lane, front and back");
  });

  it("highlights every living enemy for a blast", () => {
    const enemies = twoRowEncounter();
    enemies[3].hp = 0;
    const preview = previewSkillTargets(blastSkill, enemies, "front-1");
    expect(new Set(preview.targetIds)).toEqual(
      new Set(["front-1", "front-2", "back-1"]),
    );
    expect(preview.indicator).toBe("Hits everyone");
  });

  it("highlights just the anchor for a single-target shape", () => {
    const preview = previewSkillTargets(
      singleSkill,
      twoRowEncounter(),
      "back-1",
    );
    expect(preview.targetIds).toEqual(["back-1"]);
    expect(preview.indicator).toBeUndefined();
  });

  it("gives randomN a count-based indicator instead of a highlight set", () => {
    const preview = previewSkillTargets(
      scatterSkill,
      twoRowEncounter(),
      "front-1",
    );
    expect(preview.targetIds).toEqual([]);
    expect(preview.indicator).toBe("Hits 2 random targets");
  });

  it("clamps randomN's indicator count to how many are alive", () => {
    const enemies = twoRowEncounter();
    enemies[0].hp = 0;
    enemies[1].hp = 0;
    enemies[2].hp = 0;
    const preview = previewSkillTargets(scatterSkill, enemies, "back-2");
    expect(preview.indicator).toBe("Hits 1 random target");
  });
});

describe("battleHighlight", () => {
  const enemies = twoRowEncounter();
  const aliveEnemies = enemies;

  it("highlights only the cursor's enemy for a plain attack (no pending skill)", () => {
    const result = battleHighlight({
      mode: "target",
      knownSkills: [],
      skillCursor: 0,
      pendingSkillId: null,
      targetCursor: 2,
      enemies,
      aliveEnemies,
    });
    expect(result.highlightedIds).toEqual(new Set(["back-1"]));
  });

  it("expands to the resolved shape once a row skill is pending in target mode", () => {
    const result = battleHighlight({
      mode: "target",
      knownSkills: [rowSkill],
      skillCursor: 0,
      pendingSkillId: "hailstorm",
      targetCursor: 0,
      enemies,
      aliveEnemies,
    });
    expect(result.highlightedIds).toEqual(new Set(["front-1", "front-2"]));
  });

  it("previews allEnemies while still browsing the skill list", () => {
    const result = battleHighlight({
      mode: "skill",
      knownSkills: [blastSkill],
      skillCursor: 0,
      pendingSkillId: null,
      targetCursor: 0,
      enemies,
      aliveEnemies,
    });
    expect(result.highlightedIds).toEqual(
      new Set(["front-1", "front-2", "back-1", "back-2"]),
    );
    expect(result.indicator).toBe("Hits everyone");
  });

  it("shows randomN's indicator without highlighting specific enemies", () => {
    const result = battleHighlight({
      mode: "skill",
      knownSkills: [scatterSkill],
      skillCursor: 0,
      pendingSkillId: null,
      targetCursor: 0,
      enemies,
      aliveEnemies,
    });
    expect(result.highlightedIds).toEqual(new Set());
    expect(result.indicator).toBe("Hits 2 random targets");
  });

  it("does not highlight anything while browsing a single-target skill", () => {
    const result = battleHighlight({
      mode: "skill",
      knownSkills: [singleSkill],
      skillCursor: 0,
      pendingSkillId: null,
      targetCursor: 0,
      enemies,
      aliveEnemies,
    });
    expect(result.highlightedIds).toEqual(new Set());
    expect(result.indicator).toBeUndefined();
  });
});

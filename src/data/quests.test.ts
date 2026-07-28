import { describe, expect, it } from "vitest";
import { findDungeon } from "./dungeons";
import { findMonster } from "./monsters";
import { findQuestItem } from "./questItems";
import { findQuest, QUESTS } from "./quests";

describe("QUESTS data table", () => {
  it("references real monster, dungeon, and quest item ids", () => {
    for (const quest of QUESTS) {
      const objective = quest.objective;
      if (objective.type === "kill") {
        expect(findMonster(objective.monsterId)).toBeDefined();
      } else if (objective.type === "clear") {
        expect(findDungeon(objective.dungeonId)).toBeDefined();
      } else {
        expect(findQuestItem(objective.questItemId)).toBeDefined();
      }
    }
  });

  it("covers all three objective kinds", () => {
    const kinds = new Set(QUESTS.map((quest) => quest.objective.type));
    expect(kinds).toEqual(new Set(["kill", "clear", "fetch"]));
  });

  it("exposes findQuest", () => {
    expect(findQuest("slime-cull")?.title).toBe("Slime Cull");
    expect(findQuest("nope")).toBeUndefined();
  });
});

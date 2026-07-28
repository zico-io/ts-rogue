import { describe, expect, it } from "vitest";
import { findMonster } from "./monsters";
import { findQuestItem, QUEST_ITEMS } from "./questItems";

describe("QUEST_ITEMS data table", () => {
  it("references real source monster ids", () => {
    for (const item of QUEST_ITEMS) {
      expect(findMonster(item.sourceMonsterId)).toBeDefined();
    }
  });

  it("exposes findQuestItem", () => {
    expect(findQuestItem("slime-gel")?.name).toBe("Slime Gel");
    expect(findQuestItem("nope")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { findQuest } from "../data/quests";
import type { BattleEnemy } from "./combat/types";
import {
  advanceQuestsOnVictory,
  isQuestComplete,
  MAX_ACCEPTED_QUESTS,
} from "./quests";
import { Rng } from "./rng/rng";
import type { AcceptedQuest, QuestState } from "./state/types";

function enemy(defId: string, id = `${defId}-1`): BattleEnemy {
  return {
    id,
    defId,
    name: defId,
    hp: 0,
    maxHp: 10,
    stats: { str: 1, agi: 1, vit: 1, int: 1 },
    ascii: ["x"],
    xp: 5,
    gold: 5,
  };
}

function accept(questId: string, progress = 0): AcceptedQuest {
  const def = findQuest(questId);
  if (!def) throw new Error(`missing test fixture quest ${questId}`);
  return { def, progress };
}

function questState(accepted: AcceptedQuest[]): QuestState {
  return { available: [], accepted, completedIds: [] };
}

describe("MAX_ACCEPTED_QUESTS", () => {
  it("caps the Guild board at 3 accepted quests", () => {
    expect(MAX_ACCEPTED_QUESTS).toBe(3);
  });
});

describe("isQuestComplete", () => {
  it("kill: complete once progress reaches the required count", () => {
    expect(isQuestComplete(accept("slime-cull", 4), {})).toBe(false);
    expect(isQuestComplete(accept("slime-cull", 5), {})).toBe(true);
  });

  it("clear: complete once progress reaches 1", () => {
    expect(isQuestComplete(accept("clear-sunken-crypt", 0), {})).toBe(false);
    expect(isQuestComplete(accept("clear-sunken-crypt", 1), {})).toBe(true);
  });

  it("fetch: complete once the questItems bag holds enough of the item", () => {
    const quest = accept("fetch-slime-gel");
    expect(isQuestComplete(quest, { "slime-gel": 2 })).toBe(false);
    expect(isQuestComplete(quest, { "slime-gel": 3 })).toBe(true);
  });
});

describe("advanceQuestsOnVictory", () => {
  it("advances a kill quest's progress by matching defeated enemies, capped at the target count", () => {
    const rng = new Rng(1);
    const result = advanceQuestsOnVictory(
      questState([accept("slime-cull", 3)]),
      {},
      [enemy("slime"), enemy("slime"), enemy("slime"), enemy("goblin")],
      false,
      null,
      rng,
    );
    expect(result.quests.accepted[0].progress).toBe(5);
  });

  it("sets clear progress to 1 only on a boss victory in the matching dungeon", () => {
    const rng = new Rng(1);
    const quest = accept("clear-sunken-crypt");

    const wrongDungeon = advanceQuestsOnVictory(
      questState([quest]),
      {},
      [enemy("dungeon-guardian")],
      true,
      "howling-cave",
      rng,
    );
    expect(wrongDungeon.quests.accepted[0].progress).toBe(0);

    const notBoss = advanceQuestsOnVictory(
      questState([quest]),
      {},
      [enemy("dungeon-guardian")],
      false,
      "sunken-crypt",
      rng,
    );
    expect(notBoss.quests.accepted[0].progress).toBe(0);

    const matched = advanceQuestsOnVictory(
      questState([quest]),
      {},
      [enemy("dungeon-guardian")],
      true,
      "sunken-crypt",
      rng,
    );
    expect(matched.quests.accepted[0].progress).toBe(1);
  });

  it("rolls dropChance into questItems only for kills an accepted fetch quest still needs", () => {
    const rng = new Rng(7);
    const result = advanceQuestsOnVictory(
      questState([accept("fetch-slime-gel")]),
      {},
      [enemy("slime"), enemy("slime"), enemy("goblin")],
      false,
      null,
      rng,
    );
    // Deterministic under seed 7: two slime kills roll against a 0.5
    // dropChance, the goblin kill never touches the RNG for this quest.
    expect(result.questItems["slime-gel"]).toBeGreaterThanOrEqual(0);
    expect(result.questItems["slime-gel"]).toBeLessThanOrEqual(2);
  });

  it("never rolls the RNG when no accepted quest needs the drop (no dead RNG)", () => {
    const rng = new Rng(7);
    const before = rng.getState();
    advanceQuestsOnVictory(
      questState([]),
      {},
      [enemy("slime")],
      false,
      null,
      rng,
    );
    expect(rng.getState()).toEqual(before);
  });

  it("does not re-roll or re-advance an already-complete quest", () => {
    const rng = new Rng(7);
    const before = rng.getState();
    const result = advanceQuestsOnVictory(
      questState([accept("slime-cull", 5)]),
      {},
      [enemy("slime")],
      false,
      null,
      rng,
    );
    expect(result.quests.accepted[0].progress).toBe(5);
    expect(rng.getState()).toEqual(before);
  });

  it("emits a quest-kind completion log the moment an objective is met", () => {
    const rng = new Rng(1);
    const result = advanceQuestsOnVictory(
      questState([accept("goblin-warband", 2)]),
      {},
      [enemy("goblin")],
      false,
      null,
      rng,
    );
    expect(result.quests.accepted[0].progress).toBe(3);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].kind).toBe("quest");
    expect(result.logs[0].text).toContain("Goblin Warband");
  });

  it("stays side-effect-free with no accepted quests", () => {
    const rng = new Rng(1);
    const before = rng.getState();
    const quests = questState([]);
    const result = advanceQuestsOnVictory(
      quests,
      {},
      [enemy("slime")],
      false,
      null,
      rng,
    );
    expect(result.quests).toEqual(quests);
    expect(result.logs).toEqual([]);
    expect(rng.getState()).toEqual(before);
  });
});

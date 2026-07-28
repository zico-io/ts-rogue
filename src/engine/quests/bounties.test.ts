import { describe, expect, it } from "vitest";
import { findMonster } from "../../data/monsters";
import { findQuestItem } from "../../data/questItems";
import { Rng } from "../rng/rng";
import {
  FETCH_BOUNTY_BASE_GOLD,
  FETCH_BOUNTY_BASE_XP,
  generateBounties,
  KILL_BOUNTY_GOLD_MULTIPLIER,
  KILL_BOUNTY_XP_MULTIPLIER,
} from "./bounties";

describe("generateBounties", () => {
  it("is deterministic for a given seed", () => {
    const a = generateBounties(new Rng(123), 5);
    const b = generateBounties(new Rng(123), 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rolls 2-3 repeatable bounties with synthetic bounty-<n> ids", () => {
    const bounties = generateBounties(new Rng(7), 5);
    expect(bounties.length).toBeGreaterThanOrEqual(2);
    expect(bounties.length).toBeLessThanOrEqual(3);
    bounties.forEach((bounty, i) => {
      expect(bounty.id).toBe(`bounty-${i}`);
      expect(bounty.repeatable).toBe(true);
      expect(
        bounty.objective.type === "kill" || bounty.objective.type === "fetch",
      ).toBe(true);
    });
  });

  it("only offers monsters/items reachable at the hero's level", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const bounty of generateBounties(new Rng(seed), 1)) {
        if (bounty.objective.type === "kill") {
          expect(bounty.objective.monsterId).toBe("slime");
        } else if (bounty.objective.type === "fetch") {
          expect(bounty.objective.questItemId).toBe("slime-gel");
        }
      }
    }
  });

  it("scales kill rewards with monster value and objective size", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const bounty of generateBounties(new Rng(seed), 8)) {
        if (bounty.objective.type !== "kill") continue;
        const monster = findMonster(bounty.objective.monsterId);
        expect(monster).toBeDefined();
        expect(bounty.reward.gold).toBe(
          Math.round(
            bounty.objective.count *
              (monster?.gold ?? 0) *
              KILL_BOUNTY_GOLD_MULTIPLIER,
          ),
        );
        expect(bounty.reward.xp).toBe(
          Math.round(
            bounty.objective.count *
              (monster?.xp ?? 0) *
              KILL_BOUNTY_XP_MULTIPLIER,
          ),
        );
      }
    }
  });

  it("scales fetch rewards with item scarcity and objective size", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const bounty of generateBounties(new Rng(seed), 8)) {
        if (bounty.objective.type !== "fetch") continue;
        const item = findQuestItem(bounty.objective.questItemId);
        expect(item).toBeDefined();
        expect(bounty.reward.gold).toBe(
          Math.round(
            (bounty.objective.count * FETCH_BOUNTY_BASE_GOLD) /
              (item?.dropChance ?? 1),
          ),
        );
        expect(bounty.reward.xp).toBe(
          Math.round(
            (bounty.objective.count * FETCH_BOUNTY_BASE_XP) /
              (item?.dropChance ?? 1),
          ),
        );
      }
    }
  });

  it("clamps eligibility to floor 1 for a level-1 hero", () => {
    const bounties = generateBounties(new Rng(42), 1);
    expect(bounties.length).toBeGreaterThan(0);
  });
});

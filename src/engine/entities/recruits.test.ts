import { describe, expect, it } from "vitest";
import { deserialize, serialize } from "../../persistence/save";
import { newGame, reduce } from "../state/store";
import type { GameState } from "../state/types";
import { Rng } from "../rng/rng";
import { createStartingHero, MAX_PARTY } from "./party";
import { generateRecruits, recruitCost } from "./recruits";

/** Fill the party up to `size` with dummy members (hero at index 0 preserved). */
function partyOf(base: GameState, size: number): GameState {
  const extra = Array.from({ length: size - 1 }, (_, i) =>
    createStartingHero("warrior", `member-${i + 2}`, `Dummy${i + 2}`),
  );
  return { ...base, party: [base.party[0], ...extra] };
}

describe("generateRecruits", () => {
  it("is deterministic for a given seed", () => {
    const a = generateRecruits(new Rng(123), 5);
    const b = generateRecruits(new Rng(123), 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rolls 2-3 recruits with levels near the hero's", () => {
    const heroLevel = 5;
    const recruits = generateRecruits(new Rng(7), heroLevel);
    expect(recruits.length).toBeGreaterThanOrEqual(2);
    expect(recruits.length).toBeLessThanOrEqual(3);
    for (const r of recruits) {
      expect(r.level).toBeGreaterThanOrEqual(heroLevel - 1);
      expect(r.level).toBeLessThanOrEqual(heroLevel + 1);
      // Stats came from class + growth, so a leveled recruit beats a level-1 one.
      expect(r.maxHp).toBeGreaterThan(0);
    }
  });

  it("clamps recruit level to at least 1 for a level-1 hero", () => {
    for (const r of generateRecruits(new Rng(99), 1)) {
      expect(r.level).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("recruitCost", () => {
  it("scales with level", () => {
    expect(recruitCost(2)).toBeGreaterThan(recruitCost(1));
    expect(recruitCost(3)).toBe(recruitCost(1) * 3);
  });
});

describe("HireRecruit reducer", () => {
  it("debits gold and moves the recruit into the party", () => {
    const base = { ...newGame(1), gold: 9999 };
    const recruit = base.recruits[0];
    const after = reduce(base, { type: "HireRecruit", index: 0 });
    expect(after.party).toHaveLength(2);
    expect(after.party[1].name).toBe(recruit.name);
    expect(after.gold).toBe(9999 - recruitCost(recruit.level));
    expect(after.recruits).toHaveLength(base.recruits.length - 1);
  });

  it("assigns a party-unique id to avoid collisions", () => {
    const base = { ...newGame(1), gold: 9999 };
    const after = reduce(base, { type: "HireRecruit", index: 0 });
    const ids = after.party.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is blocked when the party is full", () => {
    const base = partyOf({ ...newGame(1), gold: 9999 }, MAX_PARTY);
    const after = reduce(base, { type: "HireRecruit", index: 0 });
    expect(after.party).toHaveLength(MAX_PARTY);
    expect(after.log.at(-1)?.text).toContain("already full");
  });

  it("is blocked when gold is short", () => {
    const base = { ...newGame(1), gold: 0 };
    const after = reduce(base, { type: "HireRecruit", index: 0 });
    expect(after.party).toHaveLength(1);
    expect(after.log.at(-1)?.text).toContain("Not enough gold");
  });
});

describe("DismissMember reducer", () => {
  it("removes a non-hero member", () => {
    const base = partyOf(newGame(1), 2);
    const target = base.party[1];
    const after = reduce(base, {
      type: "DismissMember",
      memberId: target.id,
    });
    expect(after.party.map((m) => m.id)).not.toContain(target.id);
  });

  it("refuses to dismiss the hero", () => {
    const base = newGame(1);
    const after = reduce(base, {
      type: "DismissMember",
      memberId: base.party[0].id,
    });
    expect(after.party).toHaveLength(1);
    expect(after.log.at(-1)?.text).toContain("cannot dismiss the hero");
  });
});

describe("persistence", () => {
  it("round-trips the recruit pool through save/load", () => {
    const state = newGame(42);
    expect(state.recruits.length).toBeGreaterThan(0);
    expect(deserialize(serialize(state)).recruits).toEqual(state.recruits);
  });

  it("backfills an empty pool for pre-ROG-21 saves", () => {
    const modern = newGame(42);
    const { recruits: _omit, ...older } = modern;
    const restored = deserialize(JSON.stringify(older));
    expect(restored.recruits).toEqual([]);
  });
});

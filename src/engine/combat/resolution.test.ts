import { describe, expect, it } from "vitest";
import { createStartingHero, type PartyMember } from "../entities/party";
import { Rng } from "../rng/rng";
import { newGame, reduce } from "../state/store";
import type { GameEvent, GameState, Scene } from "../state/types";
import { createInitialDungeonState } from "../world/dungeon";
import { generateOverworldMap } from "../world/overworld";
import {
  atkFrom,
  computeDamage,
  defFrom,
  deriveAtk,
  deriveDef,
  deriveSpd,
  fleeChance,
  grantXp,
  hitChance,
  pickEnemyGroup,
  resolveAttack,
  rollInitiative,
  spdFrom,
  startBattle,
  xpToNext,
} from "./resolution";
import type { BattleEnemy, BattleState } from "./types";

const HERO_STATS = { str: 5, agi: 5, vit: 5, int: 5 };
const SLIME_STATS = { str: 4, agi: 3, vit: 4, int: 1 };

function makeEnemy(
  id: string,
  defId: string,
  name: string,
  hp: number,
  stats: { str: number; agi: number; vit: number; int: number },
  xp: number,
  gold: number,
): BattleEnemy {
  return { id, defId, name, hp, maxHp: hp, stats, ascii: ["x"], xp, gold };
}

function battleVs(
  enemy: BattleEnemy,
  returnScene: Scene = "dungeon",
  activeMemberId = "hero-1",
): BattleState {
  return {
    enemies: [enemy],
    status: "ongoing",
    initiative: ["hero-1", enemy.id],
    awaitingCommand: true,
    returnScene,
    activeMemberId,
    defendingIds: [],
  };
}

/** Build a GameState that is mid-battle against `enemy`, on dungeon floor 1. */
function stateInBattle(
  seed: number,
  enemy: BattleEnemy,
  heroOverride: Partial<PartyMember> = {},
): GameState {
  const base = newGame(seed);
  const hero = { ...base.party[0], ...heroOverride };
  const ds = createInitialDungeonState(seed, "dungeon-0", 1);
  return {
    ...base,
    scene: "battle",
    party: [hero],
    dungeonState: { ...ds, encounter: { kind: "wandering", floor: 1 } },
    battleState: battleVs(enemy),
  };
}

describe("derived stats", () => {
  it("derives ATK from str, DEF from vit/2, and SPD from agi", () => {
    expect(deriveAtk(SLIME_STATS)).toBe(4);
    expect(deriveDef(SLIME_STATS)).toBe(2);
    expect(deriveSpd(SLIME_STATS)).toBe(3);
  });

  it("atkFrom/defFrom/spdFrom read a party member's stats", () => {
    const hero = createStartingHero();
    expect(atkFrom(hero)).toBe(7);
    expect(defFrom(hero)).toBe(3);
    expect(spdFrom(hero)).toBe(4);
  });
});

describe("hitChance", () => {
  it("is the base when speeds are equal", () => {
    expect(
      hitChance(HERO_STATS, { str: 0, agi: 5, vit: 0, int: 0 }),
    ).toBeCloseTo(0.9);
  });

  it("clamps to the ceiling for a large speed advantage", () => {
    expect(hitChance({ str: 0, agi: 50, vit: 0, int: 0 }, SLIME_STATS)).toBe(
      0.99,
    );
  });

  it("clamps to the floor when outsped", () => {
    expect(
      hitChance(
        { str: 0, agi: 0, vit: 0, int: 0 },
        { str: 0, agi: 50, vit: 0, int: 0 },
      ),
    ).toBe(0.2);
  });
});

describe("computeDamage", () => {
  const atk = HERO_STATS;
  const def = SLIME_STATS;

  it("applies the variance roll and floors at 1", () => {
    // base = 5 - 2 = 3; variance 0 -> floor(3 * 0.85) = 2
    expect(computeDamage(false, 0, atk, def, false)).toBe(2);
    // variance 1 -> floor(3 * 1.15) = 3
    expect(computeDamage(false, 1, atk, def, false)).toBe(3);
  });

  it("multiplies by the crit multiplier on a crit", () => {
    // floor(3 * 0.85) = 2, then floor(2 * 1.5) = 3
    expect(computeDamage(true, 0, atk, def, false)).toBe(3);
  });

  it("halves damage when the defender is defending", () => {
    // floor(3 * 0.85) = 2, then floor(2 * 0.5) = 1
    expect(computeDamage(false, 0, atk, def, true)).toBe(1);
  });

  it("never deals less than 1 even when ATK <= DEF", () => {
    const weak = { str: 1, agi: 0, vit: 0, int: 0 };
    const tough = { str: 0, agi: 0, vit: 20, int: 0 };
    expect(computeDamage(false, 0, weak, tough, false)).toBe(1);
  });
});

describe("resolveAttack", () => {
  it("is deterministic for a fixed seed", () => {
    const a = resolveAttack(new Rng(999), HERO_STATS, SLIME_STATS, false);
    const b = resolveAttack(new Rng(999), HERO_STATS, SLIME_STATS, false);
    expect(a).toEqual(b);
  });

  it("reports zero damage on a miss and >= 1 on a hit", () => {
    const result = resolveAttack(new Rng(999), HERO_STATS, SLIME_STATS, false);
    if (result.hit) {
      expect(result.damage).toBeGreaterThanOrEqual(1);
    } else {
      expect(result.damage).toBe(0);
      expect(result.crit).toBe(false);
    }
  });
});

describe("fleeChance", () => {
  it("shifts by speed advantage and clamps", () => {
    expect(fleeChance(5, 5)).toBeCloseTo(0.55);
    expect(fleeChance(5, 3)).toBeCloseTo(0.61);
    expect(fleeChance(100, 0)).toBe(0.9);
    expect(fleeChance(0, 100)).toBe(0.1);
  });
});

describe("level-up curve", () => {
  it("xpToNext grows exponentially", () => {
    expect(xpToNext(1)).toBe(15);
    expect(xpToNext(2)).toBe(22);
    expect(xpToNext(3)).toBe(33);
    expect(xpToNext(4)).toBe(50);
    expect(xpToNext(5)).toBe(75);
  });

  it("does not level up below the threshold and keeps HP/MP unchanged", () => {
    const hero = createStartingHero();
    const { member, leveledUp } = grantXp(hero, 5);
    expect(leveledUp).toBe(false);
    expect(member.level).toBe(1);
    expect(member.xp).toBe(5);
    expect(member.hp).toBe(24);
    expect(member.mp).toBe(6);
    expect(member.maxHp).toBe(24);
  });

  it("levels up across a threshold, raising maxHp/maxMp/stats and restoring HP/MP", () => {
    const hero = createStartingHero();
    const { member, leveledUp } = grantXp(hero, 80);
    expect(leveledUp).toBe(true);
    expect(member.level).toBe(4);
    expect(member.xp).toBe(10);
    expect(member.maxHp).toBe(48);
    expect(member.maxMp).toBe(12);
    expect(member.hp).toBe(48);
    expect(member.mp).toBe(12);
    expect(member.stats).toEqual({ str: 13, agi: 7, vit: 13, int: 2 });
  });
});

describe("rollInitiative", () => {
  it("returns a permutation of the hero and all enemy ids", () => {
    const enemies = [
      makeEnemy("slime-1", "slime", "Slime", 12, SLIME_STATS, 5, 3),
      makeEnemy(
        "goblin-1",
        "goblin",
        "Goblin",
        22,
        { str: 7, agi: 6, vit: 4, int: 3 },
        12,
        8,
      ),
    ];
    const order = rollInitiative(
      new Rng(1234),
      [createStartingHero()],
      enemies,
    );
    expect(order).toHaveLength(3);
    expect(order).toContain("hero-1");
    expect(order).toContain("slime-1");
    expect(order).toContain("goblin-1");
  });

  it("is deterministic for a fixed seed", () => {
    const enemies = [
      makeEnemy("slime-1", "slime", "Slime", 12, SLIME_STATS, 5, 3),
    ];
    const runOnce = () =>
      rollInitiative(new Rng(2024), [createStartingHero()], enemies);
    expect(runOnce()).toEqual(runOnce());
  });
});

describe("pickEnemyGroup", () => {
  it("spawns a single dungeon guardian for a boss encounter", () => {
    const group = pickEnemyGroup(new Rng(1234), "boss", 3);
    expect(group).toHaveLength(1);
    expect(group[0].defId).toBe("dungeon-guardian");
    expect(group[0].hp).toBe(group[0].maxHp);
  });

  it("wandering on floor 1 spawns 1-2 slimes", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const group = pickEnemyGroup(new Rng(seed), "wandering", 1);
      expect(group.length).toBeGreaterThanOrEqual(1);
      expect(group.length).toBeLessThanOrEqual(2);
      for (const enemy of group) expect(enemy.defId).toBe("slime");
    }
  });

  it("is deterministic for a fixed seed", () => {
    const runOnce = () => pickEnemyGroup(new Rng(777), "wandering", 3);
    expect(runOnce()).toEqual(runOnce());
  });
});

describe("startBattle", () => {
  it("builds an ongoing battle awaiting the player's command", () => {
    const battle = startBattle(
      new Rng(1234),
      [createStartingHero()],
      "wandering",
      1,
      "dungeon",
    );
    expect(battle.status).toBe("ongoing");
    expect(battle.awaitingCommand).toBe(true);
    expect(battle.returnScene).toBe("dungeon");
    expect(battle.enemies.length).toBeGreaterThanOrEqual(1);
    expect(battle.initiative).toContain("hero-1");
    expect(battle.initiative).toHaveLength(1 + battle.enemies.length);
    expect(battle.activeMemberId).toBe("hero-1");
    expect(battle.defendingIds).toEqual([]);
    for (const enemy of battle.enemies) {
      expect(battle.initiative).toContain(enemy.id);
    }
  });
});

describe("blocked actions are side-effect-free", () => {
  const slime = makeEnemy("slime-1", "slime", "Slime", 12, SLIME_STATS, 5, 3);

  it("a skill with insufficient MP is a no-op that consumes no RNG", () => {
    const state = stateInBattle(1234, slime, { mp: 1 });
    const after = reduce(state, {
      type: "BattleSkill",
      skillId: "flame",
      targetId: "slime-1",
    });
    expect(after).toBe(state);
    expect(after.rngState).toEqual(state.rngState);
  });

  it("an item the party does not own is a no-op", () => {
    const state = stateInBattle(1234, slime);
    const after = reduce(state, {
      type: "BattleItem",
      itemId: "potion",
      targetId: "hero-1",
    });
    expect(after).toBe(state);
  });
});

describe("BattleDefend", () => {
  it("takes a defensive stance and continues the round", () => {
    const slime = makeEnemy("slime-1", "slime", "Slime", 12, SLIME_STATS, 5, 3);
    const state = stateInBattle(1234, slime);
    const after = reduce(state, { type: "BattleDefend" });
    expect(after).not.toBe(state);
    expect(after.log.some((m) => m.includes("defensive stance"))).toBe(true);
    expect(after.battleState?.status).toBe("ongoing");
  });
});

describe("BattleFlee", () => {
  it("resolves the round deterministically and is never a no-op", () => {
    const slime = makeEnemy("slime-1", "slime", "Slime", 12, SLIME_STATS, 5, 3);
    const runOnce = () =>
      reduce(stateInBattle(1234, slime), { type: "BattleFlee" });
    const a = runOnce();
    expect(a).toEqual(runOnce());
    expect(a.rngState).not.toEqual(stateInBattle(1234, slime).rngState);
  });
});

describe("full win scenario", () => {
  it("casts a winning spell, levels up, and returns to the dungeon", () => {
    // A weak 3-HP enemy that yields enough XP to cross several level thresholds.
    const rich = makeEnemy(
      "rich-1",
      "slime",
      "Rich Slime",
      3,
      { str: 1, agi: 1, vit: 1, int: 1 },
      80,
      20,
    );
    const state = stateInBattle(1234, rich);
    const after = reduce(state, {
      type: "BattleSkill",
      skillId: "flame",
      targetId: "rich-1",
    });

    expect(after.scene).toBe("dungeon");
    expect(after.battleState).toBeNull();
    expect(after.dungeonState?.encounter).toBeNull();
    // 80 XP: 15 -> L2, 22 -> L3, 33 -> L4, leaving 10 below the 50 threshold.
    expect(after.party[0].level).toBe(4);
    expect(after.party[0].xp).toBe(10);
    expect(after.party[0].maxHp).toBe(48);
    expect(after.party[0].hp).toBe(48);
    expect(after.party[0].maxMp).toBe(12);
    expect(after.party[0].mp).toBe(12);
    expect(after.party[0].stats).toEqual({ str: 13, agi: 7, vit: 13, int: 2 });
    expect(after.gold).toBe(70);
    expect(after.log.some((m) => m.includes("Victory!"))).toBe(true);
    expect(after.log.some((m) => m.includes("reached level 4"))).toBe(true);
  });
});

describe("full lose scenario", () => {
  it("drives the party to KO and revives at the village", () => {
    const guardian = makeEnemy(
      "guardian-1",
      "dungeon-guardian",
      "Dungeon Guardian",
      60,
      { str: 12, agi: 5, vit: 14, int: 2 },
      80,
      120,
    );
    let after: GameState = stateInBattle(1234, guardian, { hp: 3 });
    for (let i = 0; i < 50 && after.scene === "battle"; i++) {
      after = reduce(after, { type: "BattleAttack", targetId: "guardian-1" });
    }

    expect(after.scene).toBe("village");
    expect(after.battleState).toBeNull();
    expect(after.dungeonState).toBeNull();
    // Phase 6 death handling: revive at 1 HP, 0 MP, half gold lost (floored).
    expect(after.party[0].hp).toBe(1);
    expect(after.party[0].mp).toBe(0);
    expect(after.gold).toBe(25); // 50 starting gold - floor(50 / 2)
    expect(after.flags.gameOver).toBe(false);
    const map = generateOverworldMap(1234);
    expect(after.worldState.player).toEqual(map.village);
    expect(after.worldState.encounterMeter).toBe(0);
    expect(after.log.some((m) => m.includes("falls"))).toBe(true);
    expect(after.log.some((m) => m.includes("revived at the village"))).toBe(
      true,
    );
  });
});

describe("determinism and serializability", () => {
  it("same seed and event sequence produce identical states including rngState", () => {
    const slime = makeEnemy("slime-1", "slime", "Slime", 12, SLIME_STATS, 5, 3);
    const events: GameEvent[] = [
      { type: "BattleAttack", targetId: "slime-1" },
      { type: "BattleAttack", targetId: "slime-1" },
      { type: "BattleDefend" },
      { type: "BattleAttack", targetId: "slime-1" },
      { type: "BattleAttack", targetId: "slime-1" },
      { type: "BattleAttack", targetId: "slime-1" },
      { type: "BattleAttack", targetId: "slime-1" },
    ];
    const runOnce = () => events.reduce(reduce, stateInBattle(2024, slime));
    const a = runOnce();
    const b = runOnce();
    expect(a).toEqual(b);
    expect(a.rngState).toEqual(b.rngState);
  });

  it("GameState with an active battleState survives a JSON round-trip", () => {
    const guardian = makeEnemy(
      "guardian-1",
      "dungeon-guardian",
      "Dungeon Guardian",
      60,
      { str: 12, agi: 5, vit: 14, int: 2 },
      80,
      120,
    );
    const state = reduce(stateInBattle(2024, guardian), {
      type: "BattleAttack",
      targetId: "guardian-1",
    });
    expect(state.battleState).not.toBeNull();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

/* -------------------------------------------------------------------------- */
/* Multi-member party (ROG-20)                                                */
/* -------------------------------------------------------------------------- */

/** Build a GameState mid-battle against a fixed `enemy` for a given party. */
function stateInMultiBattle(
  seed: number,
  members: PartyMember[],
  enemy: BattleEnemy,
): GameState {
  const base = newGame(seed);
  const rng = new Rng(seed, base.rngState);
  const living = members.filter((m) => m.hp > 0);
  const initiative = rollInitiative(rng, living, [enemy]);
  const livingIds = new Set(living.map((m) => m.id));
  const activeMemberId =
    initiative.find((id) => livingIds.has(id)) ?? living[0].id;
  const battleState: BattleState = {
    enemies: [enemy],
    status: "ongoing",
    initiative,
    awaitingCommand: true,
    returnScene: "dungeon",
    activeMemberId,
    defendingIds: [],
  };
  return {
    ...base,
    scene: "battle",
    rngState: rng.getState(),
    party: members,
    battleState,
  };
}

describe("multi-member party (ROG-20)", () => {
  function member(id: string, name: string): PartyMember {
    return createStartingHero("warrior", id, name);
  }

  describe("rollInitiative", () => {
    it("includes all living party members plus enemies, deterministic for a fixed seed", () => {
      const memberA = member("member-a", "Aria");
      const memberB = member("member-b", "Boro");
      const enemies = [
        makeEnemy("slime-1", "slime", "Slime", 12, SLIME_STATS, 5, 3),
      ];
      const order = rollInitiative(new Rng(42), [memberA, memberB], enemies);
      expect(order).toHaveLength(3);
      expect(order).toContain(memberA.id);
      expect(order).toContain(memberB.id);
      expect(order).toContain("slime-1");
      const again = rollInitiative(new Rng(42), [memberA, memberB], enemies);
      expect(again).toEqual(order);
    });
  });

  it("both members get a turn in a round: the active member advances to the other after one dispatch", () => {
    const memberA = member("member-a", "Aria");
    const memberB = member("member-b", "Boro");
    // Very tough so a single hit never kills it and the round keeps going.
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      SLIME_STATS,
      5,
      3,
    );
    const state = stateInMultiBattle(1234, [memberA, memberB], slime);
    const firstActive = state.battleState?.activeMemberId;
    const otherId = firstActive === memberA.id ? memberB.id : memberA.id;

    const after = reduce(state, {
      type: "BattleAttack",
      targetId: "slime-1",
    });
    expect(after.battleState?.status).toBe("ongoing");
    expect(after.battleState?.activeMemberId).toBe(otherId);
    // Both members are still present, carried forward with their current HP/MP.
    expect(after.party.map((m) => m.id).sort()).toEqual(
      [memberA.id, memberB.id].sort(),
    );
  });

  it("skips a KO'd member's turn and never routes an enemy attack to them", () => {
    const memberA = member("member-a", "Aria");
    const koMember = { ...member("member-b", "Boro"), hp: 0 };
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      SLIME_STATS,
      5,
      3,
    );
    const state = stateInMultiBattle(1234, [memberA, koMember], slime);

    expect(state.battleState?.initiative).not.toContain(koMember.id);
    expect(state.battleState?.activeMemberId).toBe(memberA.id);

    let s = state;
    for (let i = 0; i < 10 && s.battleState?.status === "ongoing"; i++) {
      s = reduce(s, { type: "BattleAttack", targetId: "slime-1" });
      expect(s.battleState?.activeMemberId).not.toBe(koMember.id);
    }
    // The KO'd member was never targeted, so their HP never moved off zero.
    expect(s.party.find((m) => m.id === koMember.id)?.hp).toBe(0);
  });

  it("defeat only fires once the whole party is down; one survivor keeps the battle ongoing", () => {
    const weakA = { ...member("member-a", "Aria"), hp: 5, maxHp: 5, mp: 0 };
    const weakB = { ...member("member-b", "Boro"), hp: 5, maxHp: 5, mp: 0 };
    const guardian = makeEnemy(
      "guardian-1",
      "dungeon-guardian",
      "Guardian",
      999,
      { str: 40, agi: 5, vit: 30, int: 2 },
      80,
      120,
    );
    let s = stateInMultiBattle(1234, [weakA, weakB], guardian);
    let sawOneDownWhileOngoing = false;
    for (let i = 0; i < 100 && s.scene === "battle"; i++) {
      s = reduce(s, { type: "BattleAttack", targetId: "guardian-1" });
      if (s.scene === "battle") {
        const aliveCount = s.party.filter((m) => m.hp > 0).length;
        expect(aliveCount).toBeGreaterThanOrEqual(1);
        if (aliveCount === 1) sawOneDownWhileOngoing = true;
      }
    }
    expect(sawOneDownWhileOngoing).toBe(true);
    // Once both are down, the battle resolves to defeat (revived at the village).
    expect(s.scene).toBe("village");
    expect(s.battleState).toBeNull();
    expect(s.party.every((m) => m.hp === 1 && m.mp === 0)).toBe(true);
  });

  it("victory grants XP to every living member but excludes a KO'd member", () => {
    const memberA = member("member-a", "Aria");
    const koMember = { ...member("member-b", "Boro"), hp: 0 };
    const richSlime = makeEnemy(
      "rich-1",
      "slime",
      "Rich Slime",
      3,
      { str: 1, agi: 1, vit: 1, int: 1 },
      80,
      20,
    );
    const state = stateInMultiBattle(1234, [memberA, koMember], richSlime);
    const after = reduce(state, {
      type: "BattleSkill",
      skillId: "flame",
      targetId: "rich-1",
    });
    expect(after.battleState).toBeNull();
    const memberAAfter = after.party.find((m) => m.id === memberA.id);
    const koAfter = after.party.find((m) => m.id === koMember.id);
    expect(memberAAfter?.xp).toBeGreaterThan(0);
    expect(koAfter?.hp).toBe(0);
    expect(koAfter?.xp).toBe(koMember.xp);
  });

  it("a successful flee carries every party member's HP/MP forward", () => {
    const memberB = member("member-b", "Boro");
    const slime = makeEnemy("slime-1", "slime", "Slime", 30, SLIME_STATS, 5, 3);
    let fled: GameState | null = null;
    for (let seed = 1; seed <= 200 && !fled; seed++) {
      // A huge speed edge pushes flee chance to its clamped max, and puts
      // this member first in initiative almost every seed.
      const fastA = {
        ...member("member-a", "Aria"),
        stats: { str: 5, agi: 999, vit: 5, int: 5 },
      };
      const candidate = stateInMultiBattle(seed, [fastA, memberB], slime);
      if (candidate.battleState?.activeMemberId !== fastA.id) continue;
      const after = reduce(candidate, { type: "BattleFlee" });
      if (after.battleState === null) fled = after;
    }
    expect(fled).not.toBeNull();
    expect(fled?.party).toHaveLength(2);
    expect(fled?.party.find((m) => m.id === memberB.id)?.hp).toBe(memberB.hp);
    expect(fled?.party.find((m) => m.id === memberB.id)?.mp).toBe(memberB.mp);
  });
});

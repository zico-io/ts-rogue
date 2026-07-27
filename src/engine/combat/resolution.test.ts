import { describe, expect, it } from "vitest";
import { createStartingHero, type PartyMember } from "../entities/party";
import { Rng } from "../rng/rng";
import { GameStore, newGame, reduce } from "../state/store";
import type { GameEvent, GameState, Scene } from "../state/types";
import { createInitialDungeonState } from "../world/dungeon";
import { generateOverworldMap } from "../world/overworld";
import {
  applyInitiativePenalty,
  atkFrom,
  computeDamage,
  defFrom,
  deriveAtk,
  deriveDef,
  deriveSpd,
  FRONT_ROW_SIZE,
  fleeChance,
  grantXp,
  hitChance,
  isMeleeTargetable,
  pickEnemyGroup,
  resolveAttack,
  rollInitiative,
  SHOCKED_VULNERABLE_MULTIPLIER,
  spdFrom,
  startBattle,
  xpToNext,
} from "./resolution";
import type { BattleEnemy, BattleState, EnemyRow } from "./types";

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
  row: EnemyRow = "front",
): BattleEnemy {
  return {
    id,
    defId,
    name,
    hp,
    maxHp: hp,
    stats,
    ascii: ["x"],
    xp,
    gold,
    row,
  };
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

function battleVsMany(
  enemies: BattleEnemy[],
  activeMemberId = "hero-1",
): BattleState {
  return {
    enemies,
    status: "ongoing",
    initiative: ["hero-1", ...enemies.map((enemy) => enemy.id)],
    awaitingCommand: true,
    returnScene: "dungeon",
    activeMemberId,
    defendingIds: [],
  };
}

function stateWithEnemies(seed: number, enemies: BattleEnemy[]): GameState {
  const base = newGame(seed);
  const ds = createInitialDungeonState(seed, "dungeon-0", 1);
  return {
    ...base,
    scene: "battle",
    party: [base.party[0]],
    dungeonState: { ...ds, encounter: { kind: "wandering", floor: 1 } },
    battleState: battleVsMany(enemies),
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
    expect(computeDamage(false, 0, atk, def, false)).toBe(2);

    expect(computeDamage(false, 1, atk, def, false)).toBe(3);
  });

  it("multiplies by the crit multiplier on a crit", () => {
    expect(computeDamage(true, 0, atk, def, false)).toBe(3);
  });

  it("halves damage when the defender is defending", () => {
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

  it("copies the monster def's browser sprite id onto the spawned enemy (ROG-44)", () => {
    const group = pickEnemyGroup(new Rng(1234), "boss", 3);
    expect(group[0].sprite).toBe("dungeon-guardian");
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

  it("places the first FRONT_ROW_SIZE enemies in front and overflows the rest to the back row (ENG-29)", () => {
    let sawBackRow = false;
    for (let seed = 1; seed <= 2000; seed++) {
      const group = pickEnemyGroup(new Rng(seed), "wandering", 3);
      group.forEach((enemy, index) => {
        const expectedRow = index < FRONT_ROW_SIZE ? "front" : "back";
        expect(enemy.row).toBe(expectedRow);
        if (enemy.row === "back") sawBackRow = true;
      });
    }
    expect(sawBackRow).toBe(true);
  });
});

describe("ENG-29 melee reachability: front row must fall before back row is targetable", () => {
  it("rejects a basic attack aimed at a living back-row enemy while the front row survives, and opens it once the front row clears", () => {
    const front = makeEnemy(
      "goblin-front",
      "slime",
      "Front Slime",
      6,
      SLIME_STATS,
      5,
      3,
      "front",
    );
    const back = makeEnemy(
      "slime-back",
      "slime",
      "Back Slime",
      999,
      SLIME_STATS,
      5,
      3,
      "back",
    );
    expect(isMeleeTargetable([front, back], back)).toBe(false);
    expect(isMeleeTargetable([front, back], front)).toBe(true);

    let state = stateWithEnemies(1234, [front, back]);
    const rejected = reduce(state, {
      type: "BattleAttack",
      targetId: "slime-back",
    });
    expect(rejected).toBe(state);

    for (
      let i = 0;
      i < 50 &&
      state.battleState?.status === "ongoing" &&
      (state.battleState.enemies.find((e) => e.id === "goblin-front")?.hp ??
        0) > 0;
      i++
    ) {
      state = reduce(state, { type: "BattleAttack", targetId: "goblin-front" });
    }
    expect(
      state.battleState?.enemies.find((e) => e.id === "goblin-front")?.hp,
    ).toBe(0);
    expect(isMeleeTargetable(state.battleState?.enemies ?? [], back)).toBe(
      true,
    );

    const after = reduce(state, {
      type: "BattleAttack",
      targetId: "slime-back",
    });
    expect(after).not.toBe(state);
    const backAfter = after.battleState?.enemies.find(
      (e) => e.id === "slime-back",
    );
    expect(backAfter?.hp).toBeLessThan(999);
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
    expect(after.log.some((m) => m.text.includes("defensive stance"))).toBe(
      true,
    );
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

    expect(after.party[0].level).toBe(4);
    expect(after.party[0].xp).toBe(10);
    expect(after.party[0].maxHp).toBe(48);
    expect(after.party[0].hp).toBe(48);
    expect(after.party[0].maxMp).toBe(12);
    expect(after.party[0].mp).toBe(12);
    expect(after.party[0].stats).toEqual({ str: 13, agi: 7, vit: 13, int: 2 });
    expect(after.gold).toBe(70);
    expect(after.log.some((m) => m.text.includes("Victory!"))).toBe(true);
    expect(after.log.some((m) => m.text.includes("reached level 4"))).toBe(
      true,
    );
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

    expect(after.party[0].hp).toBe(1);
    expect(after.party[0].mp).toBe(0);
    expect(after.gold).toBe(25);
    expect(after.flags.gameOver).toBe(false);
    const map = generateOverworldMap(1234);
    expect(after.worldState.player).toEqual(map.village);
    expect(after.worldState.encounterMeter).toBe(0);
    expect(after.log.some((m) => m.text.includes("falls"))).toBe(true);
    expect(
      after.log.some((m) => m.text.includes("revived at the village")),
    ).toBe(true);
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

    if (s.battleState?.status === "ongoing") {
      expect(s.party.find((m) => m.id === koMember.id)?.hp).toBe(0);
    }
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

describe("ENG-21 status effects and element on hit", () => {
  it("a monster attack with attackApplies attaches poison on a successful roll", () => {
    const slime = makeEnemy("slime-1", "slime", "Slime", 12, SLIME_STATS, 5, 5);
    const state = stateInBattle(1, slime);
    const after = reduce(state, { type: "BattleDefend" });

    const effects = after.party[0].effects ?? [];
    expect(effects.length).toBeGreaterThanOrEqual(1);
    const poison = effects.find((e) => e.effectId === "poison");
    expect(poison).toBeDefined();
    expect(poison?.duration).toBe(2);
    expect(poison?.potency).toBe(1);
  });

  it("a water-flavored skill (frost) applies wet on the target", () => {
    const wizard = createStartingHero("wizard", "hero-1", "Wizard");
    const fatSlime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      SLIME_STATS,
      5,
      5,
    );

    const state = stateInBattle(2, fatSlime, wizard);
    const after = reduce(state, {
      type: "BattleSkill",
      skillId: "frost",
      targetId: "slime-1",
    });

    const enemy = after.battleState?.enemies[0];
    expect(enemy).toBeDefined();
    expect(enemy?.hp).toBeGreaterThan(0);
    const effects = enemy?.effects ?? [];
    const wet = effects.find((e) => e.effectId === "wet");
    expect(wet).toBeDefined();

    expect(wet?.duration).toBe(2);
    expect(wet?.potency).toBe(1);
  });

  it("a fire-element skill is distinguishable from a physical attack in the log", () => {
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      SLIME_STATS,
      5,
      5,
    );
    const state = stateInBattle(1, slime);

    const flameState = reduce(state, {
      type: "BattleSkill",
      skillId: "flame",
      targetId: "slime-1",
    });

    const fireHits = flameState.log.filter((l) => l.text.includes("(fire)"));
    expect(fireHits.length).toBeGreaterThanOrEqual(1);
    expect(fireHits[0].kind).toBe("damage");
    expect(fireHits[0].element).toBe("fire");

    const basicState = reduce(stateInBattle(1, slime), {
      type: "BattleAttack",
      targetId: "slime-1",
    });
    const fireInBasic = basicState.log.filter((l) => l.text.includes("(fire)"));
    expect(fireInBasic.length).toBe(0);

    const basicHit = basicState.log.find((l) => l.text.includes("hits"));
    expect(basicHit?.element).toBe("physical");
  });
});

describe("ENG-22 status effect ticking", () => {
  it("poison ticks flat 3 damage per turn, decrements duration, and expires", () => {
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      { str: 1, agi: 1, vit: 1, int: 1 },
      5,
      3,
    );
    const hero = { ...createStartingHero(), hp: 30, mp: 99 };
    let state = stateInBattle(42, slime, hero);

    state = {
      ...state,
      party: [
        {
          ...state.party[0],
          effects: [
            {
              effectId: "poison" as const,
              duration: 3,
              potency: 1,
              initialDuration: 3,
            },
          ],
        },
      ],
    };

    state = reduce(state, { type: "BattleDefend" });
    const poison1 = state.party[0].effects?.find(
      (e) => e.effectId === "poison",
    );
    expect(poison1).toBeDefined();
    expect(poison1?.duration).toBe(2);

    expect(state.party[0].hp).toBeLessThanOrEqual(27);
    expect(
      state.log.some((l) => l.text.includes("takes 3 Poison damage")),
    ).toBe(true);
    const poisonTick = state.log.find((l) =>
      l.text.includes("takes 3 Poison damage"),
    );
    expect(poisonTick?.element).toBe("poison");

    state = reduce(state, { type: "BattleDefend" });
    const poison2 = state.party[0].effects?.find(
      (e) => e.effectId === "poison",
    );
    expect(poison2).toBeDefined();
    expect(poison2?.duration).toBe(1);

    state = reduce(state, { type: "BattleDefend" });
    const poison3 = state.party[0].effects?.find(
      (e) => e.effectId === "poison",
    );
    expect(poison3).toBeUndefined();
    expect(
      state.log.some((l) => l.text.includes("Poison wears off of Hero")),
    ).toBe(true);
  });

  it("burn deals front-loaded decreasing damage each tick", () => {
    const toughSlime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      { str: 1, agi: 1, vit: 1, int: 1 },
      5,
      3,
    );
    const hero = { ...createStartingHero(), mp: 99 };
    let state = stateInBattle(99, toughSlime, hero);

    state = {
      ...state,
      battleState: {
        ...state.battleState!,
        enemies: [
          {
            ...state.battleState!.enemies[0],
            effects: [
              {
                effectId: "burn" as const,
                duration: 3,
                potency: 1,
                initialDuration: 3,
              },
            ],
          },
        ],
      },
    };

    const initialHp = 999;

    state = reduce(state, { type: "BattleDefend" });
    const slimeAfter1 = state.battleState!.enemies[0];
    const burn1 = slimeAfter1.effects?.find((e) => e.effectId === "burn");
    expect(burn1).toBeDefined();
    expect(burn1!.duration).toBe(2);
    expect(initialHp - slimeAfter1.hp).toBe(5);

    state = reduce(state, { type: "BattleDefend" });
    const slimeAfter2 = state.battleState!.enemies[0];
    const burn2 = slimeAfter2.effects?.find((e) => e.effectId === "burn");
    expect(burn2).toBeDefined();
    expect(burn2!.duration).toBe(1);
    const tick2Damage =
      initialHp - slimeAfter2.hp - (initialHp - slimeAfter1.hp);
    expect(tick2Damage).toBe(3);

    state = reduce(state, { type: "BattleDefend" });
    const slimeAfter3 = state.battleState!.enemies[0];
    const burn3 = slimeAfter3.effects?.find((e) => e.effectId === "burn");
    expect(burn3).toBeUndefined();
    expect(initialHp - slimeAfter3.hp).toBe(10);
    expect(
      state.log.some((l) => l.text.includes("Burn wears off of Slime")),
    ).toBe(true);
  });
});

describe("ENG-22 effects cleared on battle end", () => {
  function poisonsState(seed: number): GameState {
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      { str: 1, agi: 1, vit: 1, int: 1 },
      5,
      3,
    );
    const hero = { ...createStartingHero(), hp: 99, mp: 99 };
    const base = stateInBattle(seed, slime, hero);
    return {
      ...base,
      party: [
        {
          ...base.party[0],
          effects: [
            {
              effectId: "poison" as const,
              duration: 3,
              potency: 1,
              initialDuration: 3,
            },
          ],
        },
      ],
      battleState: {
        ...base.battleState!,
        enemies: [
          {
            ...base.battleState!.enemies[0],
            effects: [
              {
                effectId: "burn" as const,
                duration: 2,
                potency: 1,
                initialDuration: 2,
              },
            ],
          },
        ],
      },
    };
  }

  it("clears all effects on victory", () => {
    const wizard = createStartingHero("wizard", "hero-1", "Wizard");
    const punySlime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      12,
      { str: 1, agi: 1, vit: 1, int: 1 },
      5,
      3,
    );
    let state = stateInBattle(1, punySlime, wizard);

    state = {
      ...state,
      party: [
        {
          ...state.party[0],
          mp: 99,
          effects: [
            {
              effectId: "poison" as const,
              duration: 3,
              potency: 1,
              initialDuration: 3,
            },
          ],
        },
      ],
      battleState: {
        ...state.battleState!,
        enemies: [
          {
            ...state.battleState!.enemies[0],
            effects: [
              {
                effectId: "burn" as const,
                duration: 2,
                potency: 1,
                initialDuration: 2,
              },
            ],
          },
        ],
      },
    };
    const after = reduce(state, {
      type: "BattleSkill",
      skillId: "flame",
      targetId: "slime-1",
    });
    expect(after.battleState).toBeNull();
    expect(after.party[0].effects).toBeUndefined();
  });

  it("clears all effects on defeat", () => {
    const weakHero = { ...createStartingHero(), hp: 1, mp: 99 };
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      { str: 1, agi: 1, vit: 1, int: 1 },
      5,
      3,
    );
    let state = stateInBattle(1, slime, weakHero);
    state = {
      ...state,
      party: [
        {
          ...state.party[0],
          hp: 1,
          effects: [
            {
              effectId: "poison" as const,
              duration: 3,
              potency: 1,
              initialDuration: 3,
            },
          ],
        },
      ],
    };
    const after = reduce(state, { type: "BattleDefend" });
    expect(after.battleState).toBeNull();
    expect(after.party[0].effects).toBeUndefined();
  });

  it("clears all effects on flee", () => {
    const state = poisonsState(42);

    const fastState = {
      ...state,
      party: [
        {
          ...state.party[0],
          stats: { str: 99, agi: 999, vit: 99, int: 99 },
        },
      ],
    };
    const after = reduce(fastState, { type: "BattleFlee" });
    expect(after.battleState).toBeNull();
    expect(after.party[0].effects).toBeUndefined();
  });
});

describe("ENG-23 applyInitiativePenalty", () => {
  it("moves a combatant later by the penalty positions (clamped to end)", () => {
    const order = ["A", "B", "C", "D"];

    expect(applyInitiativePenalty(order, "B", 3)).toEqual(["A", "C", "D", "B"]);

    expect(applyInitiativePenalty(order, "B", 0)).toEqual(["A", "B", "C", "D"]);

    expect(applyInitiativePenalty(order, "B", 99)).toEqual([
      "A",
      "C",
      "D",
      "B",
    ]);

    expect(applyInitiativePenalty(order, "X", 2)).toEqual(["A", "B", "C", "D"]);

    expect(applyInitiativePenalty(order, "D", 1)).toEqual(["A", "B", "C", "D"]);
  });
});
describe("ENG-23 turn skip", () => {
  it("a stunned party member skips their turn and the battle moves past them", () => {
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      { str: 1, agi: 1, vit: 1, int: 1 },
      5,
      3,
    );
    const hero = { ...createStartingHero(), hp: 30, mp: 99 };
    let state = stateInBattle(42, slime, hero);

    state = {
      ...state,
      party: [
        {
          ...state.party[0],
          effects: [
            {
              effectId: "stun" as const,
              duration: 2,
              potency: 1,
              initialDuration: 2,
            },
          ],
        },
      ],
    };

    state = reduce(state, { type: "BattleDefend" });
    expect(state.battleState?.status).toBe("ongoing");

    expect(
      state.log.some(
        (l) => l.text.includes("is stun") && l.text.includes("can't move"),
      ),
    ).toBe(true);
  });
  it("a stunned enemy skips its attack and does no damage", () => {
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      { str: 4, agi: 3, vit: 4, int: 1 },
      5,
      3,
    );
    const hero = { ...createStartingHero(), hp: 30, mp: 99 };
    let state = stateInBattle(42, slime, hero);

    state = {
      ...state,
      battleState: {
        ...state.battleState!,
        enemies: [
          {
            ...state.battleState!.enemies[0],
            effects: [
              {
                effectId: "stun" as const,
                duration: 2,
                potency: 1,
                initialDuration: 2,
              },
            ],
          },
        ],
      },
    };

    const after = reduce(state, {
      type: "BattleAttack",
      targetId: "slime-1",
    });
    expect(after.battleState?.status).toBe("ongoing");
    expect(
      after.log.some(
        (l) =>
          l.text.includes("Slime") &&
          l.text.includes("stun") &&
          l.text.includes("can't move"),
      ),
    ).toBe(true);

    expect(after.party[0].hp).toBe(30);
  });
});
describe("ENG-23 shocked stun-lite and damage vulnerability", () => {
  it("multiplies incoming damage by SHOCKED_VULNERABLE_MULTIPLIER", () => {
    const buildSlime = () =>
      makeEnemy(
        "slime-1",
        "slime",
        "Slime",
        999,
        { str: 4, agi: 3, vit: 4, int: 1 },
        5,
        3,
      );
    const hero = createStartingHero("warrior", "hero-1", "Warrior");
    const baseline = stateInBattle(42, buildSlime(), hero);
    const shockedBase = stateInBattle(42, buildSlime(), hero);
    const shocked: GameState = {
      ...shockedBase,
      battleState: {
        ...shockedBase.battleState!,
        enemies: [
          {
            ...shockedBase.battleState!.enemies[0],
            effects: [
              {
                effectId: "shocked" as const,
                duration: 2,
                potency: 1,
                initialDuration: 2,
              },
            ],
          },
        ],
      },
    };
    const afterBaseline = reduce(baseline, {
      type: "BattleAttack",
      targetId: "slime-1",
    });
    const afterShocked = reduce(shocked, {
      type: "BattleAttack",
      targetId: "slime-1",
    });
    const baselineDamage =
      999 - (afterBaseline.battleState?.enemies[0].hp ?? 999);
    const shockedDamage =
      999 - (afterShocked.battleState?.enemies[0].hp ?? 999);
    expect(baselineDamage).toBeGreaterThan(0);
    expect(shockedDamage).toBe(
      Math.ceil(baselineDamage * SHOCKED_VULNERABLE_MULTIPLIER),
    );
  });
  it("a shocked actor's stun-lite check can skip their turn", () => {
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      { str: 1, agi: 1, vit: 1, int: 1 },
      5,
      3,
    );
    const hero = { ...createStartingHero(), hp: 99, mp: 99 };
    let state = stateInBattle(1, slime, hero);
    state = {
      ...state,
      party: [
        {
          ...state.party[0],
          effects: [
            {
              effectId: "shocked" as const,
              duration: 5,
              potency: 1,
              initialDuration: 5,
            },
          ],
        },
      ],
    };
    let sawSkip = false;
    for (let i = 0; i < 6; i++) {
      state = reduce(state, { type: "BattleDefend" });
      if (state.log.some((l) => l.text.includes("seizes up"))) {
        sawSkip = true;
        break;
      }
    }
    expect(sawSkip).toBe(true);
  });
});

describe("ENG-25 status-effect clearing stays GameState-serializable", () => {
  function poisonedSoloState(seed: number, enemyHp: number): GameState {
    const slime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      enemyHp,
      SLIME_STATS,
      5,
      5,
    );
    const hero = { ...createStartingHero(), hp: 20 };
    const base = stateInBattle(seed, slime, hero);
    return {
      ...base,
      party: [
        {
          ...base.party[0],
          effects: [
            {
              effectId: "poison" as const,
              duration: 1,
              potency: 1,
              initialDuration: 1,
            },
          ],
        },
      ],
    };
  }

  // Drives `state` through `store.dispatch` via `drive`, then asserts the
  // dispatch raised no serialization incident and the resulting party's
  // effects key was actually removed (not merely falsy).
  function expectEffectsDroppedAfter(
    state: GameState,
    drive: (store: GameStore) => GameState,
  ): GameState {
    const store = new GameStore(state);
    const incidents: unknown[] = [];
    store.subscribeIncidents((incident) => incidents.push(incident));

    const after = drive(store);

    expect(incidents).toEqual([]);
    expect("effects" in after.party[0]).toBe(false);
    return after;
  }

  it("a battle won while an actor carries an effect raises no incident and drops the effects key entirely", () => {
    const state = poisonedSoloState(1, 1);
    const target = state.battleState?.enemies[0];
    if (!target) throw new Error("expected a battle target");

    const after = expectEffectsDroppedAfter(state, (store) =>
      store.dispatch({ type: "BattleAttack", targetId: target.id }),
    );

    expect(after.battleState).toBeNull();
  });

  it("an effect ticking to expiry mid-battle raises no incident and drops the effects key entirely", () => {
    const state = poisonedSoloState(2, 999);

    const after = expectEffectsDroppedAfter(state, (store) =>
      store.dispatch({ type: "BattleDefend" }),
    );

    expect(after.battleState?.status).toBe("ongoing");
    expect(
      after.log.some((l) => l.text.includes("Poison wears off of Hero")),
    ).toBe(true);
  });

  it("fleeing while an actor carries an effect raises no incident and drops the effects key entirely", () => {
    const base = poisonedSoloState(3, 999);
    const state: GameState = {
      ...base,
      party: [
        {
          ...base.party[0],
          stats: { str: 99, agi: 999, vit: 99, int: 99 },
        },
      ],
    };

    const after = expectEffectsDroppedAfter(state, (store) => {
      let result = store.getState();
      for (
        let attempt = 0;
        attempt < 10 && result.battleState !== null;
        attempt++
      ) {
        result = store.dispatch({ type: "BattleFlee" });
      }
      return result;
    });

    expect(after.battleState).toBeNull();
  });

  it("losing a battle while an actor carries an effect raises no incident and drops the effects key entirely", () => {
    const strongSlime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      { str: 40, agi: 20, vit: 20, int: 1 },
      5,
      5,
    );
    const weakHero = { ...createStartingHero(), hp: 1 };
    const base = stateInBattle(4, strongSlime, weakHero);
    const state: GameState = {
      ...base,
      party: [
        {
          ...base.party[0],
          effects: [
            {
              effectId: "poison" as const,
              duration: 3,
              potency: 1,
              initialDuration: 3,
            },
          ],
        },
      ],
    };

    const after = expectEffectsDroppedAfter(state, (store) =>
      store.dispatch({ type: "BattleDefend" }),
    );

    expect(after.battleState).toBeNull();
  });
});

describe("ENG-25 reapplying an active effect refreshes it instead of stacking", () => {
  // Seed 2 is a fixed fixture, found once offline: with this seed frost's
  // wet-apply roll (chance 0.5) succeeds on both the first and second cast
  // against this target. Hardcoded rather than searched at test time so the
  // assertion is a direct, cheap check against a known-deterministic seed
  // instead of an opaque, repeated re-simulation.
  const REFRESH_DEMO_SEED = 2;

  it("casting frost twice in a row on an already-wet target keeps a single wet instance and refreshes its duration", () => {
    const wizard = createStartingHero("wizard", "hero-1", "Wizard");
    const fatSlime = makeEnemy(
      "slime-1",
      "slime",
      "Slime",
      999,
      SLIME_STATS,
      5,
      5,
    );
    const first = reduce(stateInBattle(REFRESH_DEMO_SEED, fatSlime, wizard), {
      type: "BattleSkill",
      skillId: "frost",
      targetId: "slime-1",
    });
    const firstWet = first.battleState?.enemies[0].effects?.find(
      (e) => e.effectId === "wet",
    );
    expect(firstWet).toBeDefined();
    expect(first.battleState?.activeMemberId).toBe("hero-1");

    // A freshly (re)applied effect still ticks once more later in the same
    // round (the enemy's own turn immediately follows the hero's cast), so
    // the refreshed instance surfaces as duration 2 (3, ticked once) rather
    // than 3.
    const second = reduce(first, {
      type: "BattleSkill",
      skillId: "frost",
      targetId: "slime-1",
    });
    const wetInstances = (second.battleState?.enemies[0].effects ?? []).filter(
      (e) => e.effectId === "wet",
    );
    expect(wetInstances).toHaveLength(1);
    expect(wetInstances[0].duration).toBe(2);
    expect(wetInstances[0].initialDuration).toBe(3);
  });
});

describe("ENG-12 status cures", () => {
  // defId deliberately does not match a MONSTERS entry, so findMonster
  // returns undefined and the enemy's counter-attack never rolls
  // attackApplies (e.g. the real slime's 30% poison-on-hit) - keeping these
  // cure/cleanse assertions free of an unrelated, randomly reapplied status.
  const dummy = () =>
    makeEnemy("dummy-1", "training-dummy", "Dummy", 999, SLIME_STATS, 5, 3);

  it("using an Antidote on a poisoned party member removes the poison status and is consumed", () => {
    const hero = { ...createStartingHero(), hp: 30, mp: 0 };
    let state = stateInBattle(7, dummy(), hero);
    state = {
      ...state,
      inventory: [{ itemId: "antidote", quantity: 1 }],
      party: [
        {
          ...state.party[0],
          effects: [
            {
              effectId: "poison" as const,
              duration: 3,
              potency: 1,
              initialDuration: 3,
            },
          ],
        },
      ],
    };

    const after = reduce(state, {
      type: "BattleItem",
      itemId: "antidote",
      targetId: "hero-1",
    });

    expect(after).not.toBe(state);
    expect(after.party[0].effects).toBeUndefined();
    expect(after.inventory).toEqual([]);
    expect(after.log.some((l) => l.text.includes("cured of Poison"))).toBe(
      true,
    );
  });

  it("the burn/chill cure item removes both burn and chilled without touching unrelated effects", () => {
    const hero = { ...createStartingHero(), hp: 30, mp: 0 };
    let state = stateInBattle(7, dummy(), hero);
    state = {
      ...state,
      inventory: [{ itemId: "thermal-salts", quantity: 1 }],
      party: [
        {
          ...state.party[0],
          effects: [
            {
              effectId: "burn" as const,
              duration: 2,
              potency: 1,
              initialDuration: 2,
            },
            { effectId: "chilled" as const, duration: 2, potency: 1 },
            { effectId: "slow" as const, duration: 2, potency: 1 },
          ],
        },
      ],
    };

    const after = reduce(state, {
      type: "BattleItem",
      itemId: "thermal-salts",
      targetId: "hero-1",
    });

    expect(after).not.toBe(state);
    const remaining = after.party[0].effects ?? [];
    expect(remaining.map((e) => e.effectId)).toEqual(["slow"]);
    expect(after.inventory).toEqual([]);
    expect(
      after.log.some((l) => l.text.includes("cured of Burn and Chilled")),
    ).toBe(true);
  });

  it("a cure item with nothing to cure is still consumed and logs no effect", () => {
    const hero = { ...createStartingHero(), hp: 30, mp: 0 };
    const state = {
      ...stateInBattle(7, dummy(), hero),
      inventory: [{ itemId: "antidote", quantity: 1 }],
    };

    const after = reduce(state, {
      type: "BattleItem",
      itemId: "antidote",
      targetId: "hero-1",
    });

    expect(after.inventory).toEqual([]);
    expect(after.log.some((l) => l.text.includes("nothing to cure"))).toBe(
      true,
    );
  });

  it("Heal-kind skills cleanse the caster's status effects along with restoring HP (documented Heal-cleanse decision)", () => {
    const hero = { ...createStartingHero(), hp: 5, mp: 99 };
    let state = stateInBattle(7, dummy(), hero);
    state = {
      ...state,
      party: [
        {
          ...state.party[0],
          effects: [
            {
              effectId: "poison" as const,
              duration: 2,
              potency: 1,
              initialDuration: 2,
            },
            { effectId: "slow" as const, duration: 2, potency: 1 },
          ],
        },
      ],
    };

    const after = reduce(state, {
      type: "BattleSkill",
      skillId: "heal",
      targetId: "hero-1",
    });

    expect(after.party[0].hp).toBeGreaterThan(5);
    expect(after.party[0].effects).toBeUndefined();
    expect(
      after.log.some((l) => l.text.includes("cleansed of Poison and Slow")),
    ).toBe(true);
  });
});

describe("ENG-20 loot toast (finalizeWon)", () => {
  // Dungeon Guardian has tier-3 loot table (dropChance=1), guaranteeing drops.
  function bossEnemy(id = "guardian-1"): ReturnType<typeof makeEnemy> {
    return makeEnemy(
      id,
      "dungeon-guardian",
      "Guardian",
      1,
      SLIME_STATS,
      80,
      120,
    );
  }

  it("kept item log entries carry the item rarity on victory (seed 1)", () => {
    // Seed 1 yields 2 kept items (unique war-blade + unique guardian-greatsword).
    const state = stateInBattle(1, bossEnemy());
    const after = reduce(state, {
      type: "BattleAttack",
      targetId: "guardian-1",
    });
    const lootLines = after.log.filter((l) => l.text.startsWith("Looted "));
    expect(lootLines.length).toBeGreaterThanOrEqual(1);
    for (const line of lootLines) {
      expect(line.kind).toBe("loot");
      expect(line.rarity).toBeDefined();
      expect(["common", "magic", "rare", "unique"]).toContain(line.rarity);
    }
  });

  it("dismantle summary line appears with correct count and gold (seed 10)", () => {
    // Seed 10 yields 1 common war-blade + 1 unique guardian-signet.
    // Filter { 1: "magic" } dismantles the common war-blade.
    const boss = bossEnemy();
    let state = stateInBattle(10, boss);
    state = reduce(state, {
      type: "SetLootFilter",
      rules: { minRarityByTier: { 1: "magic" }, keepAffixStats: [] },
    });
    const goldBefore = state.gold;
    const after = reduce(state, {
      type: "BattleAttack",
      targetId: "guardian-1",
    });
    const dismantleLine = after.log.find((l) =>
      l.text.startsWith("Dismantled "),
    );
    expect(dismantleLine).toBeDefined();
    expect(dismantleLine?.text).toMatch(/^Dismantled \d+ item\(s\) -> \d+g$/);
    expect(dismantleLine?.kind).toBe("loot");
    expect(after.lastLootOutcome?.dismantled.length).toBeGreaterThan(0);
    expect(dismantleLine?.text).toContain(
      `${after.lastLootOutcome?.goldGained}g`,
    );
    expect(after.gold).toBeGreaterThan(goldBefore);
  });
});

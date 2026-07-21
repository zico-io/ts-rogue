/**
 * Turn-based combat resolution (PROJECT_PLAN Phase 4, ROG-10).
 *
 * All randomness routes through the seeded `Rng` wrapper and the consumed
 * state is persisted back onto `GameState.rngState`, so a seed plus an event
 * history always reproduces the same battle. Resolution is pure: nothing
 * mutates the input state. The store's battle event cases are thin wrappers
 * around `resolveBattleEvent`; the three encounter trigger points call
 * `startBattle`.
 *
 * Round model: at battle start a single initiative order is rolled and reused
 * every round. When the player picks a command, the whole round resolves in
 * initiative order in one synchronous reducer step - the hero acts at their
 * initiative slot (executing the player's command), each living enemy
 * auto-attacks at its slot, and win/lose is re-checked after every action. A
 * new round begins if the battle is still ongoing when the order is exhausted.
 * Blocked actions (insufficient MP, no usable item, no living target) are
 * fully side-effect-free: they return the state untouched and consume no RNG,
 * so replays stay deterministic even if the UI hands in a disallowed command.
 *
 * Phase 6 (ROG-12) adds death handling: a `lost` battle either revives the
 * party at the village with a gold penalty (default) or ends the run with a
 * terminal game-over flag (permadeath). A boss victory also marks the dungeon
 * cleared so the player knows it is safe to leave.
 */

import { DEFAULT_CLASS_ID, findClass } from "../../data/classes";
import { findMonster, MONSTERS, type MonsterDef } from "../../data/monsters";
import { findShopItem } from "../../data/shops";
import type { InventoryItem, PartyMember } from "../entities/party";
import { effectiveStats } from "../loot/equipment";
import { describeItem } from "../loot/items";
import { rollVictoryLoot } from "../loot/resolution";
import type { ItemInstance } from "../loot/types";
import { Rng, type RngState } from "../rng/rng";
import {
  entry,
  type GameState,
  type LogEntry,
  type Scene,
} from "../state/types";
import {
  createInitialWorldState,
  generateOverworldMap,
} from "../world/overworld";
import type { DungeonState, WorldState } from "../world/types";
import { findSkill, type SkillDef } from "./skills";
import type {
  BattleEnemy,
  BattleEvent,
  BattleState,
  BattleStatus,
  CoreStats,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Tunable constants                                                          */
/* -------------------------------------------------------------------------- */

/** Base hit chance before the speed delta is applied. */
export const HIT_BASE = 0.9;
/** Hit chance shifts by this much per point of speed advantage. */
export const HIT_SPD_FACTOR = 0.02;
export const HIT_MIN = 0.2;
export const HIT_MAX = 0.99;
/** Chance a connecting hit becomes a crit. */
export const CRIT_CHANCE = 0.08;
/** Crit damage multiplier. */
export const CRIT_MULTIPLIER = 1.5;
/** Damage variance range as a multiplier of (atk - def). */
export const DAMAGE_VARIANCE_MIN = 0.85;
export const DAMAGE_VARIANCE_MAX = 1.15;
/** A defending combatant takes this fraction of incoming damage. */
export const DEFEND_DAMAGE_FACTOR = 0.5;
/** Initiative roll = spd + rng.next() * spread; ties break by combatant order. */
export const INITIATIVE_SPREAD = 8;
/** Base flee chance before the speed delta is applied. */
export const FLEE_BASE = 0.55;
export const FLEE_SPD_FACTOR = 0.03;
export const FLEE_MIN = 0.1;
export const FLEE_MAX = 0.9;

/** Level-up curve: xp needed to advance from `level` to `level + 1`. */
export const XP_BASE = 10;
export const XP_GROWTH = 1.5;

/** Battle healing items and how much HP they restore. */
export const BATTLE_ITEM_HEAL: Readonly<Record<string, number>> = {
  potion: 30,
  "hi-potion": 99,
};

/* -------------------------------------------------------------------------- */
/* Derived stats                                                              */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Attack power from strength. */
export function deriveAtk(stats: CoreStats): number {
  return stats.str;
}

/** Defense from vitality (halved, rounded down). */
export function deriveDef(stats: CoreStats): number {
  return Math.floor(stats.vit / 2);
}

/** Speed from agility, which drives initiative and hit/flee adjustments. */
export function deriveSpd(stats: CoreStats): number {
  return stats.agi;
}

export function atkFrom(member: PartyMember): number {
  return deriveAtk(effectiveStats(member));
}

export function defFrom(member: PartyMember): number {
  return deriveDef(effectiveStats(member));
}

export function spdFrom(member: PartyMember): number {
  return deriveSpd(effectiveStats(member));
}

/**
 * The core stat a skill scales off. Older skills omit `stat` and default to
 * `int`, so prior Flame/Heal behavior is unchanged; class skills declare the
 * stat they scale with (Warrior Cleave uses str, Rogue Backstab uses agi).
 */
export function skillStatValue(skill: SkillDef, stats: CoreStats): number {
  return stats[skill.stat ?? "int"];
}

/* -------------------------------------------------------------------------- */
/* Hit / crit / damage                                                        */
/* -------------------------------------------------------------------------- */

/** Hit chance for an attacker vs a defender, clamped to [HIT_MIN, HIT_MAX]. */
export function hitChance(atkStats: CoreStats, defStats: CoreStats): number {
  return clamp(
    HIT_BASE + (deriveSpd(atkStats) - deriveSpd(defStats)) * HIT_SPD_FACTOR,
    HIT_MIN,
    HIT_MAX,
  );
}

/**
 * Final damage for a connecting hit, given the crit flag and the variance roll
 * in [0, 1). Pure and RNG-free so the damage formula can be asserted exactly.
 */
export function computeDamage(
  crit: boolean,
  variance: number,
  atkStats: CoreStats,
  defStats: CoreStats,
  defenderDefending: boolean,
): number {
  let base = deriveAtk(atkStats) - deriveDef(defStats);
  if (base < 1) base = 1;
  let damage = Math.floor(
    base *
      (DAMAGE_VARIANCE_MIN +
        variance * (DAMAGE_VARIANCE_MAX - DAMAGE_VARIANCE_MIN)),
  );
  if (crit) damage = Math.floor(damage * CRIT_MULTIPLIER);
  if (defenderDefending) damage = Math.floor(damage * DEFEND_DAMAGE_FACTOR);
  return Math.max(1, damage);
}

export interface AttackResult {
  hit: boolean;
  crit: boolean;
  damage: number;
}

/**
 * Resolve one attack through the seeded RNG. Consumes one roll on a miss, and
 * three (hit, crit, variance) on a connect - so a miss never advances the
 * generator past the rolls a hit would have used, keeping outcomes stable.
 */
export function resolveAttack(
  rng: Rng,
  atkStats: CoreStats,
  defStats: CoreStats,
  defenderDefending: boolean,
): AttackResult {
  const hitRoll = rng.next();
  if (hitRoll >= hitChance(atkStats, defStats)) {
    return { hit: false, crit: false, damage: 0 };
  }
  const crit = rng.next() < CRIT_CHANCE;
  const variance = rng.next();
  return {
    hit: true,
    crit,
    damage: computeDamage(
      crit,
      variance,
      atkStats,
      defStats,
      defenderDefending,
    ),
  };
}

/** Flee chance vs the fastest living enemy, clamped to [FLEE_MIN, FLEE_MAX]. */
export function fleeChance(heroSpd: number, fastestEnemySpd: number): number {
  return clamp(
    FLEE_BASE + (heroSpd - fastestEnemySpd) * FLEE_SPD_FACTOR,
    FLEE_MIN,
    FLEE_MAX,
  );
}

/* -------------------------------------------------------------------------- */
/* Level-up curve                                                             */
/* -------------------------------------------------------------------------- */

/** XP required to advance from `level` to `level + 1` (exponential). */
export function xpToNext(level: number): number {
  return Math.floor(XP_BASE * XP_GROWTH ** level);
}

export interface GrantXpResult {
  member: PartyMember;
  leveledUp: boolean;
}

/**
 * Add `amount` XP to `member`, leveling up as many times as the threshold
 * allows. Each level-up raises maxHp/maxMp and each stat by the hero's class
 * growth and restores HP/MP to full. `member.xp` holds progress toward the
 * next level, with the remainder carried across each level-up. Pure.
 */
export function grantXp(member: PartyMember, amount: number): GrantXpResult {
  let level = member.level;
  let xp = member.xp + amount;
  let maxHp = member.maxHp;
  let maxMp = member.maxMp;
  let stats = member.stats;
  let leveledUp = false;
  const growth = (findClass(member.classId) ?? findClass(DEFAULT_CLASS_ID))
    ?.growth;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    leveledUp = true;
    if (growth) {
      maxHp += growth.hp;
      maxMp += growth.mp;
      stats = {
        str: stats.str + growth.str,
        agi: stats.agi + growth.agi,
        vit: stats.vit + growth.vit,
        int: stats.int + growth.int,
      };
    }
  }
  const updated: PartyMember = { ...member, level, xp, maxHp, maxMp, stats };
  if (leveledUp) {
    updated.hp = maxHp;
    updated.mp = maxMp;
  }
  return { member: updated, leveledUp };
}

/* -------------------------------------------------------------------------- */
/* Initiative, enemy groups, battle setup                                     */
/* -------------------------------------------------------------------------- */

/**
 * Roll a fixed initiative order for the hero plus the enemy group. Each
 * combatant rolls `spd + rng.next() * spread`; ties break by a fixed order
 * (hero first, then enemies by spawn index) so the order is fully determined
 * by the seed without relying on sort stability.
 */
export function rollInitiative(
  rng: Rng,
  heroId: string,
  heroSpd: number,
  enemies: readonly BattleEnemy[],
): string[] {
  const entries: Array<{ id: string; roll: number; order: number }> = [
    { id: heroId, roll: heroSpd + rng.next() * INITIATIVE_SPREAD, order: 0 },
  ];
  enemies.forEach((enemy, index) => {
    entries.push({
      id: enemy.id,
      roll: deriveSpd(enemy.stats) + rng.next() * INITIATIVE_SPREAD,
      order: index + 1,
    });
  });
  entries.sort((a, b) => b.roll - a.roll || a.order - b.order);
  return entries.map((entry) => entry.id);
}

/** Spawn one enemy instance from a monster definition. */
function makeEnemy(def: MonsterDef, instance: number): BattleEnemy {
  return {
    id: `${def.id}-${instance}`,
    defId: def.id,
    name: def.name,
    hp: def.maxHp,
    maxHp: def.maxHp,
    stats: { ...def.stats },
    ascii: def.ascii,
    color: def.color,
    xp: def.xp,
    gold: def.gold,
  };
}

/**
 * Pick the enemy group for an encounter. A boss encounter is always a single
 * dungeon guardian; a wandering encounter rolls a count (growing with floor)
 * and picks each member from the monsters eligible for that floor. All
 * randomness uses the seeded `rng` so the group is deterministic from the seed.
 */
export function pickEnemyGroup(
  rng: Rng,
  kind: "wandering" | "boss",
  floor: number,
): BattleEnemy[] {
  if (kind === "boss") {
    const guardian = findMonster("dungeon-guardian");
    if (!guardian)
      throw new Error("dungeon-guardian monster missing from data");
    return [makeEnemy(guardian, 1)];
  }
  const eligible = MONSTERS.filter(
    (monster) => monster.minFloor <= floor && monster.id !== "dungeon-guardian",
  );
  const count = rng.int(1, Math.min(3, 1 + floor));
  const enemies: BattleEnemy[] = [];
  for (let i = 0; i < count; i++) {
    enemies.push(makeEnemy(rng.pick(eligible), i + 1));
  }
  return enemies;
}

/**
 * Build a fresh `BattleState`: pick the enemy group, roll initiative, and mark
 * the battle ongoing and awaiting the player's first command. The `rng` is
 * advanced in place; the caller persists `rng.getState()` onto the state.
 */
export function startBattle(
  rng: Rng,
  hero: PartyMember,
  kind: "wandering" | "boss",
  floor: number,
  returnScene: Scene,
): BattleState {
  const enemies = pickEnemyGroup(rng, kind, floor);
  const initiative = rollInitiative(rng, hero.id, spdFrom(hero), enemies);
  return {
    enemies,
    status: "ongoing",
    initiative,
    awaitingCommand: true,
    returnScene,
  };
}

/* -------------------------------------------------------------------------- */
/* Battle items                                                               */
/* -------------------------------------------------------------------------- */

export function isBattleHealItem(itemId: string): boolean {
  return itemId in BATTLE_ITEM_HEAL;
}

export function battleItemHealAmount(itemId: string): number {
  return BATTLE_ITEM_HEAL[itemId] ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Round resolution                                                           */
/* -------------------------------------------------------------------------- */

type Command =
  | { kind: "attack"; targetId: string }
  | { kind: "skill"; skillId: string; targetId: string }
  | { kind: "item"; itemId: string; targetId: string }
  | { kind: "defend" }
  | { kind: "flee" };

function allDead(enemies: readonly BattleEnemy[]): boolean {
  return enemies.every((enemy) => enemy.hp <= 0);
}

function firstAlive(enemies: readonly BattleEnemy[]): BattleEnemy | undefined {
  return enemies.find((enemy) => enemy.hp > 0);
}

function clearEncounter(ds: DungeonState | null): DungeonState | null {
  if (!ds?.encounter) return ds;
  return { ...ds, encounter: null };
}

function villageWorldState(seed: number): WorldState {
  return createInitialWorldState(generateOverworldMap(seed));
}

function consumeItem(
  inventory: readonly InventoryItem[],
  itemId: string,
): InventoryItem[] {
  const owned = inventory.find((entry) => entry.itemId === itemId);
  if (!owned) return [...inventory];
  const remaining = owned.quantity - 1;
  return remaining > 0
    ? inventory.map((entry) =>
        entry.itemId === itemId ? { ...entry, quantity: remaining } : entry,
      )
    : inventory.filter((entry) => entry.itemId !== itemId);
}

function validateCommand(
  command: Command,
  hero: PartyMember,
  inventory: readonly InventoryItem[],
  enemies: readonly BattleEnemy[],
): boolean {
  switch (command.kind) {
    case "attack":
      return enemies.some((enemy) => enemy.hp > 0);
    case "skill": {
      const skill = findSkill(command.skillId);
      return !!skill && hero.mp >= skill.mpCost;
    }
    case "item": {
      const owned = inventory.find((entry) => entry.itemId === command.itemId);
      return !!owned && owned.quantity > 0 && isBattleHealItem(command.itemId);
    }
    case "defend":
      return true;
    case "flee":
      return true;
  }
}

interface HeroActionResult {
  heroHp: number;
  heroMp: number;
  enemies: BattleEnemy[];
  defending: boolean;
  itemUsed: string | null;
  fled: boolean;
}

/**
 * Execute the player's chosen command at the hero's initiative slot. Enemy
 * elements in `enemies` are working copies and are mutated in place; the
 * returned array is the same reference. Consumes RNG only for random outcomes
 * (attack rolls, spell variance, the flee attempt).
 */
function applyHeroCommand(
  command: Command,
  hero: PartyMember,
  heroHp: number,
  heroMp: number,
  enemies: BattleEnemy[],
  rng: Rng,
  logs: LogEntry[],
): HeroActionResult {
  let hp = heroHp;
  let mp = heroMp;
  let defending = false;
  let itemUsed: string | null = null;
  let fled = false;
  const heroStats = effectiveStats(hero);

  switch (command.kind) {
    case "attack": {
      const target =
        enemies.find((e) => e.id === command.targetId && e.hp > 0) ??
        firstAlive(enemies);
      if (target) {
        const result = resolveAttack(rng, heroStats, target.stats, false);
        if (!result.hit) {
          logs.push(entry(`Hero attacks ${target.name} but misses!`, "damage"));
        } else {
          target.hp = Math.max(0, target.hp - result.damage);
          logs.push(
            entry(
              `Hero hits ${target.name} for ${result.damage}${result.crit ? " - crit!" : ""}`,
              "damage",
            ),
          );
          if (target.hp === 0)
            logs.push(entry(`${target.name} is defeated!`, "damage"));
        }
      }
      break;
    }
    case "skill": {
      const skill = findSkill(command.skillId);
      if (!skill || mp < skill.mpCost) {
        logs.push(entry("Not enough MP!"));
        break;
      }
      mp -= skill.mpCost;
      if (skill.kind === "attack") {
        const target =
          enemies.find((e) => e.id === command.targetId && e.hp > 0) ??
          firstAlive(enemies);
        if (target) {
          const variance = rng.next();
          const damage = Math.max(
            1,
            Math.floor(
              (skill.power + skillStatValue(skill, heroStats)) *
                (DAMAGE_VARIANCE_MIN +
                  variance * (DAMAGE_VARIANCE_MAX - DAMAGE_VARIANCE_MIN)),
            ),
          );
          target.hp = Math.max(0, target.hp - damage);
          logs.push(
            entry(
              `Hero casts ${skill.name} on ${target.name} for ${damage}!`,
              "damage",
            ),
          );
          if (target.hp === 0)
            logs.push(entry(`${target.name} is defeated!`, "damage"));
        }
      } else {
        const heal = skill.power + skillStatValue(skill, heroStats);
        hp = Math.min(hero.maxHp, hp + heal);
        logs.push(entry(`Hero casts ${skill.name} and recovers ${heal} HP.`));
      }
      break;
    }
    case "item": {
      const heal = battleItemHealAmount(command.itemId);
      if (heal > 0) {
        hp = Math.min(hero.maxHp, hp + heal);
        itemUsed = command.itemId;
        const name = findShopItem(command.itemId)?.name ?? command.itemId;
        logs.push(entry(`Hero uses ${name} and recovers ${heal} HP.`));
      } else {
        logs.push(entry(`Hero uses ${command.itemId}... nothing happens.`));
      }
      break;
    }
    case "defend": {
      defending = true;
      logs.push(entry("Hero takes a defensive stance."));
      break;
    }
    case "flee": {
      const fastestEnemySpd = enemies.reduce(
        (max, e) => (e.hp > 0 ? Math.max(max, deriveSpd(e.stats)) : max),
        0,
      );
      const roll = rng.next();
      if (roll < fleeChance(spdFrom(hero), fastestEnemySpd)) {
        fled = true;
        logs.push(entry("You flee the battle!"));
      } else {
        logs.push(entry("You fail to flee!"));
      }
      break;
    }
  }

  return { heroHp: hp, heroMp: mp, enemies, defending, itemUsed, fled };
}

/**
 * Apply victory: award XP/gold, level up, clear the battle and the dungeon
 * encounter flag, and return to the battle's prior scene. A boss victory also
 * marks the dungeon cleared (Phase 6, ROG-12) so the player can leave knowing
 * the dungeon is done.
 */
function finalizeWon(
  state: GameState,
  bs: BattleState,
  enemies: BattleEnemy[],
  heroHp: number,
  heroMp: number,
  logs: LogEntry[],
  rngState: RngState,
  itemUsed: string | null,
  loot: readonly ItemInstance[],
  nextItemId: number,
): GameState {
  const xpGain = enemies.reduce((sum, e) => sum + e.xp, 0);
  const goldGain = enemies.reduce((sum, e) => sum + e.gold, 0);
  const heroAfterBattle = { ...state.party[0], hp: heroHp, mp: heroMp };
  const granted = grantXp(heroAfterBattle, xpGain);
  // Check for a boss victory before clearing the encounter flag so the
  // dungeon can be marked cleared.
  const wasBossVictory = state.dungeonState?.encounter?.kind === "boss";
  const finalLogs = [
    ...logs,
    entry(`Victory! Gained ${xpGain} XP and ${goldGain} gold.`, "loot"),
  ];
  if (granted.leveledUp) {
    finalLogs.push(
      entry(
        `${granted.member.name} reached level ${granted.member.level}!`,
        "quest",
      ),
    );
  }
  if (wasBossVictory) {
    finalLogs.push(
      entry("The dungeon guardian falls. The dungeon is cleared!", "quest"),
    );
  }
  const lootLogs = loot.map((item) =>
    entry(`Looted ${describeItem(item)}!`, "loot"),
  );
  const inventory = itemUsed
    ? consumeItem(state.inventory, itemUsed)
    : state.inventory;
  const items = loot.length ? [...state.items, ...loot] : state.items;
  const clearedDungeon = clearEncounter(state.dungeonState);
  const dungeonState =
    clearedDungeon && wasBossVictory
      ? { ...clearedDungeon, cleared: true }
      : clearedDungeon;
  return {
    ...state,
    rngState,
    scene: bs.returnScene,
    party: state.party.map((member, index) =>
      index === 0 ? granted.member : member,
    ),
    gold: state.gold + goldGain,
    inventory,
    items,
    nextItemId,
    dungeonState,
    battleState: null,
    log: [...state.log, ...finalLogs, ...lootLogs],
  };
}

/**
 * Apply defeat (Phase 6, ROG-12 death handling). In permadeath mode the run
 * ends: the terminal `gameOver` flag is set so the UI shows a game-over screen
 * and clears the save. In the default mode the party is revived at the village
 * with 1 HP and loses half their gold (floored); the dungeon run is discarded
 * and the run continues. The penalty math is deterministic (no RNG) so the
 * run stays reproducible from the seed. The scene is left unchanged in
 * permadeath mode because the UI checks `gameOver` before routing by scene.
 */
function finalizeLost(
  state: GameState,
  logs: LogEntry[],
  rngState: RngState,
  itemUsed: string | null,
): GameState {
  const inventory = itemUsed
    ? consumeItem(state.inventory, itemUsed)
    : state.inventory;

  if (state.flags.permadeath) {
    const finalLogs = [
      ...logs,
      entry("The party has perished. The run is over.", "damage"),
    ];
    return {
      ...state,
      rngState,
      battleState: null,
      dungeonState: null,
      inventory,
      flags: { ...state.flags, gameOver: true },
      log: [...state.log, ...finalLogs],
    };
  }

  const goldLoss = Math.floor(state.gold / 2);
  const finalLogs = [
    ...logs,
    entry(
      "The party falls... revived at the village, losing half your gold.",
      "damage",
    ),
  ];
  return {
    ...state,
    rngState,
    scene: "village",
    gold: state.gold - goldLoss,
    party: state.party.map((member) => ({
      ...member,
      hp: 1,
      mp: 0,
    })),
    inventory,
    dungeonState: null,
    worldState: villageWorldState(state.seed),
    battleState: null,
    log: [...state.log, ...finalLogs],
  };
}

/** Apply a successful flee: clear the battle and return to the prior scene. */
function finalizeFled(
  state: GameState,
  bs: BattleState,
  heroHp: number,
  heroMp: number,
  logs: LogEntry[],
  rngState: RngState,
  itemUsed: string | null,
): GameState {
  const inventory = itemUsed
    ? consumeItem(state.inventory, itemUsed)
    : state.inventory;
  return {
    ...state,
    rngState,
    scene: bs.returnScene,
    party: state.party.map((member, index) =>
      index === 0 ? { ...member, hp: heroHp, mp: heroMp } : member,
    ),
    inventory,
    dungeonState: clearEncounter(state.dungeonState),
    battleState: null,
    log: [...state.log, ...logs],
  };
}

/**
 * Resolve one player command into a full round, then finalize victory, defeat,
 * flee, or the next awaiting-command state. Pure: returns a new `GameState`.
 */
export function resolveBattleEvent(
  state: GameState,
  event: BattleEvent,
): GameState {
  const bs = state.battleState;
  if (bs?.status !== "ongoing" || !bs?.awaitingCommand) return state;

  const command: Command = (() => {
    switch (event.type) {
      case "BattleAttack":
        return { kind: "attack", targetId: event.targetId };
      case "BattleSkill":
        return {
          kind: "skill",
          skillId: event.skillId,
          targetId: event.targetId,
        };
      case "BattleItem":
        return { kind: "item", itemId: event.itemId, targetId: event.targetId };
      case "BattleDefend":
        return { kind: "defend" };
      case "BattleFlee":
        return { kind: "flee" };
    }
  })();

  const hero = state.party[0];
  const heroEffective = effectiveStats(hero);
  if (hero.hp <= 0) return state;
  if (!validateCommand(command, hero, state.inventory, bs.enemies))
    return state;

  // Defensive: a battle somehow left with all enemies dead resolves as a win
  // without consuming RNG.
  if (allDead(bs.enemies)) {
    return finalizeWon(
      state,
      bs,
      bs.enemies,
      hero.hp,
      hero.mp,
      [],
      state.rngState,
      null,
      [],
      state.nextItemId,
    );
  }

  const rng = new Rng(state.seed, state.rngState);
  const enemies = bs.enemies.map((enemy) => ({ ...enemy }));
  let heroHp = hero.hp;
  let heroMp = hero.mp;
  let defending = false;
  let itemUsed: string | null = null;
  let status: BattleStatus = "ongoing";
  const logs: LogEntry[] = [];

  for (const combatantId of bs.initiative) {
    if (status !== "ongoing") break;
    if (combatantId === hero.id) {
      if (heroHp <= 0) break;
      const result = applyHeroCommand(
        command,
        hero,
        heroHp,
        heroMp,
        enemies,
        rng,
        logs,
      );
      heroHp = result.heroHp;
      heroMp = result.heroMp;
      defending = result.defending;
      if (result.itemUsed) itemUsed = result.itemUsed;
      if (result.fled) {
        status = "fled";
        break;
      }
      if (allDead(enemies)) {
        status = "won";
        break;
      }
    } else {
      if (heroHp <= 0) break;
      const enemy = enemies.find((e) => e.id === combatantId && e.hp > 0);
      if (!enemy) continue;
      const attack = resolveAttack(rng, enemy.stats, heroEffective, defending);
      if (!attack.hit) {
        logs.push(entry(`${enemy.name} attacks Hero but misses!`, "damage"));
      } else {
        heroHp = Math.max(0, heroHp - attack.damage);
        logs.push(
          entry(
            `${enemy.name} hits Hero for ${attack.damage}${attack.crit ? " - crit!" : ""}`,
            "damage",
          ),
        );
        if (heroHp <= 0) {
          status = "lost";
          break;
        }
      }
    }
  }

  let loot: ItemInstance[] = [];
  let nextItemId = state.nextItemId;
  if (status === "won") {
    const result = rollVictoryLoot(rng, enemies, state.nextItemId);
    loot = result.items;
    nextItemId = result.nextId;
  }
  const rngState = rng.getState();

  if (status === "won") {
    return finalizeWon(
      state,
      bs,
      enemies,
      heroHp,
      heroMp,
      logs,
      rngState,
      itemUsed,
      loot,
      nextItemId,
    );
  }
  if (status === "lost") {
    return finalizeLost(state, logs, rngState, itemUsed);
  }
  if (status === "fled") {
    return finalizeFled(state, bs, heroHp, heroMp, logs, rngState, itemUsed);
  }

  // Round exhausted with the battle still ongoing: await the next command.
  const inventory = itemUsed
    ? consumeItem(state.inventory, itemUsed)
    : state.inventory;
  return {
    ...state,
    rngState,
    party: state.party.map((member, index) =>
      index === 0 ? { ...member, hp: heroHp, mp: heroMp } : member,
    ),
    inventory,
    battleState: { ...bs, enemies, status: "ongoing", awaitingCommand: true },
    log: [...state.log, ...logs],
  };
}

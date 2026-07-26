import { DEFAULT_CLASS_ID, findClass } from "../../data/classes";
import { findMonster, MONSTERS, type MonsterDef } from "../../data/monsters";
import { findShopItem } from "../../data/shops";
import type { InventoryItem, PartyMember } from "../entities/party";
import { consumeItem, healAmount, isHealItem } from "../loot/consumables";
import { effectiveStats } from "../loot/equipment";
import { FIELD_BACKPACK_CAP } from "../loot/inventory";
import { describeItem } from "../loot/items";
import {
  applyLootPickupWithFilter,
  buildLootFilterContext,
  queueLootTriage,
} from "../loot/pickup";
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
  AppliedEffect,
  EffectInstance,
  Element,
  StatusEffectId,
} from "./statusEffects";
import { findStatusEffect } from "./statusEffects";
import type {
  BattleEnemy,
  BattleEvent,
  BattleState,
  BattleStatus,
  CoreStats,
} from "./types";

export const HIT_BASE = 0.9;

export const HIT_SPD_FACTOR = 0.02;
export const HIT_MIN = 0.2;
export const HIT_MAX = 0.99;

export const CRIT_CHANCE = 0.08;

export const CRIT_MULTIPLIER = 1.5;

export const DAMAGE_VARIANCE_MIN = 0.85;
export const DAMAGE_VARIANCE_MAX = 1.15;

export const DEFEND_DAMAGE_FACTOR = 0.5;

export const INITIATIVE_SPREAD = 8;

export const FLEE_BASE = 0.55;
export const FLEE_SPD_FACTOR = 0.03;
export const FLEE_MIN = 0.1;
export const FLEE_MAX = 0.9;

export const XP_BASE = 10;
export const XP_GROWTH = 1.5;

export const SHOCKED_VULNERABLE_MULTIPLIER = 1.5;

export interface PendingReorder {
  id: string;
  penalty: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function deriveAtk(stats: CoreStats): number {
  return stats.str;
}

export function deriveDef(stats: CoreStats): number {
  return Math.floor(stats.vit / 2);
}

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

export function skillStatValue(skill: SkillDef, stats: CoreStats): number {
  return stats[skill.stat ?? "int"];
}

export function hitChance(atkStats: CoreStats, defStats: CoreStats): number {
  return clamp(
    HIT_BASE + (deriveSpd(atkStats) - deriveSpd(defStats)) * HIT_SPD_FACTOR,
    HIT_MIN,
    HIT_MAX,
  );
}

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

export function fleeChance(heroSpd: number, fastestEnemySpd: number): number {
  return clamp(
    FLEE_BASE + (heroSpd - fastestEnemySpd) * FLEE_SPD_FACTOR,
    FLEE_MIN,
    FLEE_MAX,
  );
}

export function xpToNext(level: number): number {
  return Math.floor(XP_BASE * XP_GROWTH ** level);
}

export interface GrantXpResult {
  member: PartyMember;
  leveledUp: boolean;
}

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

export function rollInitiative(
  rng: Rng,
  party: readonly PartyMember[],
  enemies: readonly BattleEnemy[],
): string[] {
  const entries: Array<{ id: string; roll: number; order: number }> = [];
  party.forEach((member, index) => {
    entries.push({
      id: member.id,
      roll: spdFrom(member) + rng.next() * INITIATIVE_SPREAD,
      order: index,
    });
  });
  enemies.forEach((enemy, index) => {
    entries.push({
      id: enemy.id,
      roll: deriveSpd(enemy.stats) + rng.next() * INITIATIVE_SPREAD,
      order: party.length + index,
    });
  });
  entries.sort((a, b) => b.roll - a.roll || a.order - b.order);
  return entries.map((entry) => entry.id);
}

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
    sprite: def.sprite,
    xp: def.xp,
    gold: def.gold,
  };
}

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

export function startBattle(
  rng: Rng,
  party: readonly PartyMember[],
  kind: "wandering" | "boss",
  floor: number,
  returnScene: Scene,
): BattleState {
  const living = party.filter((member) => member.hp > 0);
  const enemies = pickEnemyGroup(rng, kind, floor);
  const initiative = rollInitiative(rng, living, enemies);
  const livingIds = new Set(living.map((member) => member.id));

  const activeMemberId =
    initiative.find((id) => livingIds.has(id)) ?? living[0]?.id ?? party[0].id;
  return {
    enemies,
    status: "ongoing",
    initiative,
    awaitingCommand: true,
    returnScene,
    activeMemberId,
    defendingIds: [],
  };
}

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

function validateCommand(
  command: Command,
  actor: PartyMember,
  inventory: readonly InventoryItem[],
  enemies: readonly BattleEnemy[],
): boolean {
  switch (command.kind) {
    case "attack":
      return enemies.some((enemy) => enemy.hp > 0);
    case "skill": {
      const skill = findSkill(command.skillId);
      return !!skill && actor.mp >= skill.mpCost;
    }
    case "item": {
      const owned = inventory.find((entry) => entry.itemId === command.itemId);
      return !!owned && owned.quantity > 0 && isHealItem(command.itemId);
    }
    case "defend":
      return true;
    case "flee":
      return true;
  }
}

interface MemberActionResult {
  defending: boolean;
  itemUsed: string | null;
  fled: boolean;
}

function applyEffect(
  target: BattleEnemy | PartyMember,
  effectId: StatusEffectId,
  duration: number,
  potency: number,
): void {
  target.effects = target.effects ?? [];
  // Reapplying an active effect refreshes it in place rather than stacking a
  // second, independently ticking instance of the same status.
  const existing = target.effects.find(
    (effect) => effect.effectId === effectId,
  );
  if (existing) {
    existing.duration = duration;
    existing.initialDuration = duration;
    existing.potency = potency;
    return;
  }
  target.effects.push({
    effectId,
    duration,
    potency,
    initialDuration: duration,
  });
}

function formatElementTag(element: Element | undefined): string {
  return element && element !== "physical" ? ` (${element})` : "";
}

function rollAppliesEffects(
  target: BattleEnemy | PartyMember,
  applies: readonly AppliedEffect[] | undefined,
  rng: Rng,
  logs: LogEntry[],
  pendingReorders: PendingReorder[],
): void {
  if (!applies) return;
  for (const app of applies) {
    if (rng.next() < app.chance) {
      applyEffect(target, app.effectId, app.duration, 1);
      const def = findStatusEffect(app.effectId);
      const name = def?.name ?? app.effectId;
      logs.push(entry(`${target.name} is afflicted with ${name}!`, "damage"));
      if (def?.initiativePenalty) {
        pendingReorders.push({ id: target.id, penalty: def.initiativePenalty });
      }
    }
  }
}

function tickSingleEffect(
  effect: EffectInstance,
  effectName: string,
  damage: number,
  actorName: string,
  logs: LogEntry[],
): EffectInstance | null {
  logs.push(
    entry(`${actorName} takes ${damage} ${effectName} damage!`, "damage"),
  );

  const nextDuration = effect.duration - 1;

  if (nextDuration <= 0) {
    logs.push(entry(`${effectName} wears off of ${actorName}.`, "system"));
    return null;
  }

  return { ...effect, duration: nextDuration };
}

function tickEffects(actor: BattleEnemy | PartyMember, logs: LogEntry[]): void {
  if (!actor.effects || actor.effects.length === 0) return;

  const remaining: EffectInstance[] = [];
  for (const effect of actor.effects) {
    const def = findStatusEffect(effect.effectId);

    if (def?.damagePerTurn) {
      const { amount, frontLoaded } = def.damagePerTurn;
      let damage: number;
      // Damage uses the pre-decrement duration so an expiring effect still ticks.
      if (frontLoaded && effect.initialDuration && effect.initialDuration > 0) {
        damage = Math.max(
          1,
          Math.round((amount * effect.duration) / effect.initialDuration),
        );
      } else {
        damage = Math.max(1, amount);
      }

      actor.hp = Math.max(0, actor.hp - damage);

      const result = tickSingleEffect(
        effect,
        def.name,
        damage,
        actor.name,
        logs,
      );
      if (result !== null) {
        remaining.push(result);
      }
    } else {
      const nextDuration = effect.duration - 1;
      if (nextDuration <= 0) {
        const name = def?.name ?? effect.effectId;
        logs.push(entry(`${name} wears off of ${actor.name}.`, "system"));
      } else {
        remaining.push({ ...effect, duration: nextDuration });
      }
    }
  }
  if (remaining.length > 0) {
    actor.effects = remaining;
  } else {
    // Delete rather than assign `undefined`: GameState must stay strictly
    // JSON-serializable, and an explicit `undefined` property value fails
    // that check even though the key would be dropped on stringify.
    delete actor.effects;
  }
}

function shouldSkipTurn(
  actor: BattleEnemy | PartyMember,
  rng: Rng,
  logs: LogEntry[],
): boolean {
  if (!actor.effects) return false;
  for (const effect of actor.effects) {
    const def = findStatusEffect(effect.effectId);
    if (def?.skipsTurn) {
      logs.push(
        entry(
          `${actor.name} is ${def.name.toLowerCase()} and can't move!`,
          "system",
        ),
      );
      return true;
    }
    if (def?.skipChance && rng.next() < def.skipChance) {
      logs.push(
        entry(
          `${actor.name} seizes up from the shock and can't act!`,
          "system",
        ),
      );
      return true;
    }
  }
  return false;
}

function applyVulnerability(
  target: BattleEnemy | PartyMember,
  damage: number,
): number {
  if (!target.effects) return damage;
  for (const effect of target.effects) {
    const def = findStatusEffect(effect.effectId);
    if (def?.damageVulnerable) {
      return Math.ceil(damage * SHOCKED_VULNERABLE_MULTIPLIER);
    }
  }
  return damage;
}

export function applyInitiativePenalty(
  order: readonly string[],
  id: string,
  penalty: number,
): string[] {
  const idx = order.indexOf(id);
  if (idx === -1) return [...order];
  const newIdx = Math.min(order.length - 1, idx + penalty);
  if (newIdx === idx) return [...order];
  const copy = [...order];
  copy.splice(idx, 1);
  copy.splice(newIdx, 0, id);
  return copy;
}

function applyMemberCommand(
  command: Command,
  actor: PartyMember,
  _party: PartyMember[],
  enemies: BattleEnemy[],
  rng: Rng,
  logs: LogEntry[],
  pendingReorders: PendingReorder[],
): MemberActionResult {
  let defending = false;
  let itemUsed: string | null = null;
  let fled = false;
  const actorStats = effectiveStats(actor);

  switch (command.kind) {
    case "attack": {
      const target =
        enemies.find((e) => e.id === command.targetId && e.hp > 0) ??
        firstAlive(enemies);
      if (target) {
        const result = resolveAttack(rng, actorStats, target.stats, false);
        if (!result.hit) {
          logs.push(
            entry(`${actor.name} attacks ${target.name} but misses!`, "damage"),
          );
        } else {
          const finalDamage = applyVulnerability(target, result.damage);
          target.hp = Math.max(0, target.hp - finalDamage);
          logs.push(
            entry(
              `${actor.name} hits ${target.name} for ${finalDamage}${result.crit ? " - crit!" : ""}`,
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
      if (!skill || actor.mp < skill.mpCost) {
        logs.push(entry("Not enough MP!"));
        break;
      }
      actor.mp -= skill.mpCost;
      if (skill.kind === "attack") {
        const target =
          enemies.find((e) => e.id === command.targetId && e.hp > 0) ??
          firstAlive(enemies);
        if (target) {
          const variance = rng.next();
          const damage = Math.max(
            1,
            Math.floor(
              (skill.power + skillStatValue(skill, actorStats)) *
                (DAMAGE_VARIANCE_MIN +
                  variance * (DAMAGE_VARIANCE_MAX - DAMAGE_VARIANCE_MIN)),
            ),
          );
          const finalDamage = applyVulnerability(target, damage);
          target.hp = Math.max(0, target.hp - finalDamage);

          const elementTag = formatElementTag(skill.element);
          logs.push(
            entry(
              `${actor.name} casts ${skill.name} on ${target.name} for ${finalDamage}${elementTag}!`,
              "damage",
            ),
          );
          if (target.hp === 0)
            logs.push(entry(`${target.name} is defeated!`, "damage"));

          rollAppliesEffects(target, skill.applies, rng, logs, pendingReorders);
        }
      } else {
        const heal = skill.power + skillStatValue(skill, actorStats);
        actor.hp = Math.min(actor.maxHp, actor.hp + heal);
        logs.push(
          entry(`${actor.name} casts ${skill.name} and recovers ${heal} HP.`),
        );
      }
      break;
    }
    case "item": {
      const heal = healAmount(command.itemId);
      if (heal > 0) {
        actor.hp = Math.min(actor.maxHp, actor.hp + heal);
        itemUsed = command.itemId;
        const name = findShopItem(command.itemId)?.name ?? command.itemId;
        logs.push(entry(`${actor.name} uses ${name} and recovers ${heal} HP.`));
      } else {
        logs.push(
          entry(`${actor.name} uses ${command.itemId}... nothing happens.`),
        );
      }
      break;
    }
    case "defend": {
      defending = true;
      logs.push(entry(`${actor.name} takes a defensive stance.`));
      break;
    }
    case "flee": {
      const fastestEnemySpd = enemies.reduce(
        (max, e) => (e.hp > 0 ? Math.max(max, deriveSpd(e.stats)) : max),
        0,
      );
      const roll = rng.next();
      if (roll < fleeChance(spdFrom(actor), fastestEnemySpd)) {
        fled = true;
        logs.push(entry("You flee the battle!"));
      } else {
        logs.push(entry("You fail to flee!"));
      }
      break;
    }
  }

  return { defending, itemUsed, fled };
}

interface AdvanceResult {
  status: "ongoing" | "lost";
  nextActorId: string | null;
}

function advanceRound(
  initiative: readonly string[],
  fromIndex: number,
  party: PartyMember[],
  enemies: BattleEnemy[],
  defendingIds: Set<string>,
  rng: Rng,
  logs: LogEntry[],
  pendingReorders: PendingReorder[],
): AdvanceResult {
  for (let step = 0; step < initiative.length; step++) {
    const index = (fromIndex + 1 + step) % initiative.length;
    const id = initiative[index];

    const member = party.find((m) => m.id === id);
    if (member) {
      if (member.hp > 0) {
        tickEffects(member, logs);

        if (shouldSkipTurn(member, rng, logs)) {
          continue;
        }
        return { status: "ongoing", nextActorId: member.id };
      }
      continue;
    }

    const enemy = enemies.find((e) => e.id === id);
    if (!enemy || enemy.hp <= 0) continue;

    tickEffects(enemy, logs);

    if (shouldSkipTurn(enemy, rng, logs)) {
      continue;
    }

    const living = party.filter((m) => m.hp > 0);
    if (living.length === 0) return { status: "lost", nextActorId: null };
    const target = rng.pick(living);
    const attack = resolveAttack(
      rng,
      enemy.stats,
      effectiveStats(target),
      defendingIds.has(target.id),
    );

    const monsterDef = findMonster(enemy.defId);
    const attackElement = monsterDef?.attackElement;
    const attackApplies = monsterDef?.attackApplies;

    if (!attack.hit) {
      logs.push(
        entry(`${enemy.name} attacks ${target.name} but misses!`, "damage"),
      );
    } else {
      const finalDamage = applyVulnerability(target, attack.damage);
      target.hp = Math.max(0, target.hp - finalDamage);

      const elementTag = formatElementTag(attackElement);
      logs.push(
        entry(
          `${enemy.name} hits ${target.name} for ${finalDamage}${elementTag}${attack.crit ? " - crit!" : ""}`,
          "damage",
        ),
      );

      rollAppliesEffects(target, attackApplies, rng, logs, pendingReorders);

      if (party.every((m) => m.hp <= 0)) {
        return { status: "lost", nextActorId: null };
      }
    }
  }

  const firstAliveMember = party.find((m) => m.hp > 0);
  if (firstAliveMember) {
    return { status: "ongoing", nextActorId: firstAliveMember.id };
  }
  return { status: "lost", nextActorId: null };
}

function clearBattleEffects(
  party: PartyMember[],
  enemies: BattleEnemy[],
): void {
  for (const member of party) {
    delete member.effects;
  }
  for (const enemy of enemies) {
    delete enemy.effects;
  }
}

function finalizeWon(
  state: GameState,
  bs: BattleState,
  enemies: BattleEnemy[],
  party: PartyMember[],
  logs: LogEntry[],
  rngState: RngState,
  itemUsed: string | null,
  loot: readonly ItemInstance[],
  nextItemId: number,
): GameState {
  clearBattleEffects(party, enemies);
  const xpGain = enemies.reduce((sum, e) => sum + e.xp, 0);
  const goldGain = enemies.reduce((sum, e) => sum + e.gold, 0);

  const wasBossVictory = state.dungeonState?.encounter?.kind === "boss";
  const levelUpLogs: LogEntry[] = [];
  const finalParty = party.map((member) => {
    if (member.hp <= 0) return member;
    const granted = grantXp(member, xpGain);
    if (granted.leveledUp) {
      levelUpLogs.push(
        entry(
          `${granted.member.name} reached level ${granted.member.level}!`,
          "quest",
        ),
      );
    }
    return granted.member;
  });
  const finalLogs = [
    ...logs,
    entry(`Victory! Gained ${xpGain} XP and ${goldGain} gold.`, "loot"),
    ...levelUpLogs,
  ];
  if (wasBossVictory) {
    finalLogs.push(
      entry("The dungeon guardian falls. The dungeon is cleared!", "quest"),
    );
  }

  const filterContext = buildLootFilterContext(
    state.party,
    state.dungeonState?.floor ?? null,
  );
  const pickup = applyLootPickupWithFilter(
    state.items,
    loot,
    FIELD_BACKPACK_CAP,
    state.lootFilter,
    filterContext,
  );
  const pendingLootTriage = queueLootTriage(
    state.pendingLootTriage,
    pickup.queued,
  );

  const lootLogs = pickup.outcome.kept.map((item) =>
    entry(`Looted ${describeItem(item)}!`, "loot"),
  );
  const triageLogs = pickup.queued.length
    ? [
        entry(
          `Your backpack is full - ${pickup.queued.length} item(s) await a swap-or-dismantle decision`,
          "loot",
        ),
      ]
    : [];
  const inventory = itemUsed
    ? consumeItem(state.inventory, itemUsed)
    : state.inventory;
  const clearedDungeon = clearEncounter(state.dungeonState);
  const dungeonState =
    clearedDungeon && wasBossVictory
      ? { ...clearedDungeon, cleared: true }
      : clearedDungeon;
  return {
    ...state,
    rngState,
    scene: bs.returnScene,
    party: finalParty,
    gold: state.gold + goldGain + pickup.outcome.goldGained,
    inventory,
    items: pickup.items,
    nextItemId,
    lastLootOutcome: pickup.outcome,
    pendingLootTriage,
    dungeonState,
    battleState: null,
    log: [...state.log, ...finalLogs, ...lootLogs, ...triageLogs],
  };
}

function finalizeLost(
  state: GameState,
  logs: LogEntry[],
  rngState: RngState,
  itemUsed: string | null,
): GameState {
  // Rest-destructure to omit `effects` entirely rather than assigning it
  // `undefined`: GameState must stay strictly JSON-serializable, and an
  // explicit `undefined` property value fails that check. (tickEffects and
  // clearBattleEffects instead `delete` the key because they already hold a
  // mutable local copy to mutate in place; this map builds a fresh object
  // per member, so the single-expression omission is the simpler fit here.)
  const clearedParty = state.party.map(
    ({ effects: _effects, ...cleared }) => cleared,
  );
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
      party: clearedParty,
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
    party: clearedParty.map((member) => ({
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

function finalizeFled(
  state: GameState,
  bs: BattleState,
  party: PartyMember[],
  logs: LogEntry[],
  rngState: RngState,
  itemUsed: string | null,
): GameState {
  clearBattleEffects(party, bs.enemies);
  const inventory = itemUsed
    ? consumeItem(state.inventory, itemUsed)
    : state.inventory;
  return {
    ...state,
    rngState,
    scene: bs.returnScene,
    party,
    inventory,
    dungeonState: clearEncounter(state.dungeonState),
    battleState: null,
    log: [...state.log, ...logs],
  };
}

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

  const actor = state.party.find((m) => m.id === bs.activeMemberId);
  if (!actor || actor.hp <= 0) return state;
  if (!validateCommand(command, actor, state.inventory, bs.enemies))
    return state;

  if (allDead(bs.enemies)) {
    return finalizeWon(
      state,
      bs,
      bs.enemies,
      state.party,
      [],
      state.rngState,
      null,
      [],
      state.nextItemId,
    );
  }

  const rng = new Rng(state.seed, state.rngState);
  const party = state.party.map((m) => ({ ...m }));
  const enemies = bs.enemies.map((enemy) => ({ ...enemy }));
  const defendingIds = new Set(bs.defendingIds);
  const logs: LogEntry[] = [];
  const pendingReorders: PendingReorder[] = [];

  const actorCopy = party[state.party.indexOf(actor)];

  defendingIds.delete(actorCopy.id);
  const result = applyMemberCommand(
    command,
    actorCopy,
    party,
    enemies,
    rng,
    logs,
    pendingReorders,
  );
  if (result.defending) defendingIds.add(actorCopy.id);
  const itemUsed = result.itemUsed;

  let status: BattleStatus;
  let nextActorId: string | null = null;
  if (result.fled) {
    status = "fled";
  } else if (allDead(enemies)) {
    status = "won";
  } else {
    const advance = advanceRound(
      bs.initiative,
      bs.initiative.indexOf(actorCopy.id),
      party,
      enemies,
      defendingIds,
      rng,
      logs,
      pendingReorders,
    );
    status = advance.status;
    nextActorId = advance.nextActorId;
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
      party,
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
    return finalizeFled(state, bs, party, logs, rngState, itemUsed);
  }

  if (nextActorId === null)
    throw new Error("ongoing battle resolved without a next actor");
  const inventory = itemUsed
    ? consumeItem(state.inventory, itemUsed)
    : state.inventory;

  let finalInitiative = bs.initiative;
  // Reorders affect the next dispatch, never the round already being traversed.
  for (const reorder of pendingReorders) {
    finalInitiative = applyInitiativePenalty(
      finalInitiative,
      reorder.id,
      reorder.penalty,
    );
  }

  return {
    ...state,
    rngState,
    party,
    inventory,
    battleState: {
      ...bs,
      enemies,
      status: "ongoing",
      awaitingCommand: true,
      activeMemberId: nextActorId,
      defendingIds: [...defendingIds],
      initiative: finalInitiative,
    },
    log: [...state.log, ...logs],
  };
}

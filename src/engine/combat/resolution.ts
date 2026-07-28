import { DEFAULT_CLASS_ID, findClass } from "../../data/classes";
import { type DungeonDef, dungeonDefFor } from "../../data/dungeons";
import { findMonster, MONSTERS, type MonsterDef } from "../../data/monsters";
import { findShopItem } from "../../data/shops";
import type { InventoryItem, PartyMember } from "../entities/party";
import {
  consumeItem,
  curedEffects,
  healAmount,
  isUsableBattleItem,
} from "../loot/consumables";
import { effectiveStats } from "../loot/equipment";
import { FIELD_BACKPACK_CAP } from "../loot/inventory";
import {
  applyLootPickupWithFilter,
  buildLootFilterContext,
  lootLogEntries,
  queueLootTriage,
} from "../loot/pickup";
import { rollVictoryLoot, weightedPick } from "../loot/resolution";
import type { ItemInstance } from "../loot/types";
import { advanceQuestsOnVictory } from "../quests";
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
import {
  findSkill,
  resolveSkillList,
  type SkillDef,
  type SkillTarget,
} from "./skills";
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
  EnemyRow,
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

// Classic Wizardry-style formation: only the first FRONT_ROW_SIZE enemies
// in an encounter stand in front; the rest form the back row (ENG-29).
export const FRONT_ROW_SIZE = 2;
export const DEFAULT_ROW: EnemyRow = "front";

export const FLEE_BASE = 0.55;
export const FLEE_SPD_FACTOR = 0.03;
export const FLEE_MIN = 0.1;
export const FLEE_MAX = 0.9;

export const XP_BASE = 10;
export const XP_GROWTH = 1.5;

export const SHOCKED_VULNERABLE_MULTIPLIER = 1.5;

interface PendingReorder {
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
  let levelsGained = 0;
  const growth = (findClass(member.classId) ?? findClass(DEFAULT_CLASS_ID))
    ?.growth;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    levelsGained += 1;
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
  const leveledUp = levelsGained > 0;
  // One skill point per level gained, on top of the stat/HP/MP growth above.
  const skillPoints = member.skillPoints + levelsGained;
  const updated: PartyMember = {
    ...member,
    level,
    xp,
    maxHp,
    maxMp,
    stats,
    skillPoints,
  };
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

function makeEnemy(
  def: MonsterDef,
  instance: number,
  row: EnemyRow = DEFAULT_ROW,
): BattleEnemy {
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
    row,
  };
}

// Rolls one monster from a dungeon def's weighted palette (excludes the boss,
// which spawns separately from bossId).
function paletteMonster(rng: Rng, dungeonDef: DungeonDef): MonsterDef {
  const pick = weightedPick(rng, dungeonDef.palette);
  const monster = findMonster(pick.monsterId);
  if (!monster)
    throw new Error(
      `${dungeonDef.id}: palette monster "${pick.monsterId}" missing from data`,
    );
  return monster;
}

export function pickEnemyGroup(
  rng: Rng,
  kind: "wandering" | "boss",
  floor: number,
  dungeonDef?: DungeonDef,
): BattleEnemy[] {
  if (kind === "boss") {
    const bossId = dungeonDef?.bossId ?? "dungeon-guardian";
    const boss = findMonster(bossId);
    if (!boss) throw new Error(`${bossId} monster missing from data`);
    return [makeEnemy(boss, 1)];
  }
  const eligible = MONSTERS.filter(
    (monster) => monster.minFloor <= floor && monster.id !== "dungeon-guardian",
  );
  const count = rng.int(1, Math.min(3, 1 + floor));
  const enemies: BattleEnemy[] = [];
  for (let i = 0; i < count; i++) {
    const row: EnemyRow = i < FRONT_ROW_SIZE ? "front" : "back";
    const monster = dungeonDef
      ? paletteMonster(rng, dungeonDef)
      : rng.pick(eligible);
    enemies.push(makeEnemy(monster, i + 1, row));
  }
  return enemies;
}

export function startBattle(
  rng: Rng,
  party: readonly PartyMember[],
  kind: "wandering" | "boss",
  floor: number,
  returnScene: Scene,
  dungeonDef?: DungeonDef,
): BattleState {
  const living = party.filter((member) => member.hp > 0);
  const enemies = pickEnemyGroup(rng, kind, floor, dungeonDef);
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

function findAliveEnemy(
  enemies: readonly BattleEnemy[],
  id: string,
): BattleEnemy | undefined {
  return enemies.find((enemy) => enemy.id === id && enemy.hp > 0);
}

export function enemyRow(enemy: BattleEnemy): EnemyRow {
  return enemy.row ?? DEFAULT_ROW;
}

// Melee reachability rule (ENG-29): the front row must fall before the back
// row is targetable by a basic attack. Skills always ignore this rule -
// see resolveShapeTargets/castOffensiveSkill (ENG-28) for shape-aware
// skill targeting.
export function isMeleeTargetable(
  enemies: readonly BattleEnemy[],
  target: BattleEnemy,
): boolean {
  if (enemyRow(target) === "front") return true;
  return !enemies.some((enemy) => enemy.hp > 0 && enemyRow(enemy) === "front");
}

function firstMeleeTarget(
  enemies: readonly BattleEnemy[],
): BattleEnemy | undefined {
  return enemies.find(
    (enemy) => enemy.hp > 0 && isMeleeTargetable(enemies, enemy),
  );
}

interface FormationSlot {
  id: string;
  hp: number;
  row?: EnemyRow;
}

// Shared shape for anything that can carry a status effect list - both
// BattleEnemy and PartyMember satisfy this structurally, which lets the
// effect-lifecycle helpers below (and castOffensiveSkill/castHealSkill)
// operate on either side without a BattleEnemy | PartyMember union.
interface EffectCarrier {
  id: string;
  name: string;
  hp: number;
  effects?: EffectInstance[];
}

function slotRow<T extends FormationSlot>(slot: T): EnemyRow {
  return slot.row ?? DEFAULT_ROW;
}

function slotsInRow<T extends FormationSlot>(
  pool: readonly T[],
  row: EnemyRow,
): T[] {
  return pool.filter((slot) => slotRow(slot) === row);
}

function livingInRow<T extends FormationSlot>(
  pool: readonly T[],
  row: EnemyRow,
): T[] {
  return slotsInRow(pool, row).filter((slot) => slot.hp > 0);
}

// Column pierce (ENG-28): hits whichever entity occupies the anchor's lane
// (its position within its own row) in the front row and the back row
// alike, ignoring isMeleeTargetable's reachability rule entirely - a bolt
// or blast passes clean through the front rank. A side with no row data
// (the party, per ENG-29) puts everyone in the default front row, so a
// column cast against it degenerates to just the anchor.
function laneTargets<T extends FormationSlot>(
  pool: readonly T[],
  anchor: T,
): T[] {
  const laneIndex = slotsInRow(pool, slotRow(anchor)).indexOf(anchor);
  const targets: T[] = [];
  for (const row of ["front", "back"] as const) {
    const candidate = slotsInRow(pool, row)[laneIndex];
    if (candidate && candidate.hp > 0) targets.push(candidate);
  }
  return targets;
}

function pickWithoutReplacement<T>(
  rng: Rng,
  items: readonly T[],
  count: number,
): T[] {
  const pool = [...items];
  const picked: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const index = rng.int(0, pool.length - 1);
    picked.push(...pool.splice(index, 1));
  }
  return picked;
}

// Shape resolution (ENG-28): expands a SkillDef's target shape into the
// concrete list of live entities it hits. One resolver serves both sides of
// a cast - a party member casting at `enemies`, or a monster casting at
// `party` - by handing it whichever pool is the shape's side. `anchorId`
// picks the row/lane/single target when it resolves to a living pool
// member; otherwise it falls back to the pool's first living member.
// Exported (TER-3) so the BattleScreen target-highlight preview
// (src/ui/screens/battle/targetPreview.ts) can call the exact same
// resolver the real cast uses instead of a parallel copy that could drift.
export function resolveShapeTargets<T extends FormationSlot>(
  shape: SkillTarget,
  pool: readonly T[],
  anchorId: string,
  rng: Rng,
  hitCount: number | undefined,
): T[] {
  const explicit = pool.find((slot) => slot.id === anchorId && slot.hp > 0);
  const anchor = explicit ?? pool.find((slot) => slot.hp > 0);

  switch (shape) {
    case "single":
    case "self":
    case "ally":
      return anchor ? [anchor] : [];
    case "row":
      return anchor ? livingInRow(pool, slotRow(anchor)) : [];
    case "column":
      return anchor ? laneTargets(pool, anchor) : [];
    case "allEnemies":
    case "allAllies":
      return pool.filter((slot) => slot.hp > 0);
    case "randomN": {
      const living = pool.filter((slot) => slot.hp > 0);
      const count = Math.min(Math.max(1, hitCount ?? 1), living.length);
      return pickWithoutReplacement(rng, living, count);
    }
  }
}

// Skill damage rolls a crit and a variance factor per target, same shape as
// a basic attack's resolveAttack, but scales off the skill's own power/stat
// instead of atk-minus-def: skills bypass the defender's DEF entirely, the
// pre-ENG-28 single-target formula extended to per-target multi-hit shapes.
export function computeSkillDamage(
  skill: SkillDef,
  crit: boolean,
  variance: number,
  atkStats: CoreStats,
  defenderDefending: boolean,
): number {
  let damage = Math.floor(
    (skill.power + skillStatValue(skill, atkStats)) *
      (DAMAGE_VARIANCE_MIN +
        variance * (DAMAGE_VARIANCE_MAX - DAMAGE_VARIANCE_MIN)),
  );
  if (crit) damage = Math.floor(damage * CRIT_MULTIPLIER);
  if (defenderDefending) damage = Math.floor(damage * DEFEND_DAMAGE_FACTOR);
  return Math.max(1, damage);
}

export interface SkillHitResult {
  crit: boolean;
  damage: number;
}

export function resolveSkillHit(
  rng: Rng,
  skill: SkillDef,
  atkStats: CoreStats,
  defenderDefending: boolean,
): SkillHitResult {
  const crit = rng.next() < CRIT_CHANCE;
  const variance = rng.next();
  return {
    crit,
    damage: computeSkillDamage(
      skill,
      crit,
      variance,
      atkStats,
      defenderDefending,
    ),
  };
}

// Applies an attack-kind skill to each already-resolved target in turn -
// one independent crit/damage/status roll per target, not a single roll
// broadcast to every target (ENG-28). Used by both a party member's
// BattleSkill command and a monster's advanceRound turn.
function castOffensiveSkill<T extends EffectCarrier>(
  skill: SkillDef,
  casterName: string,
  casterStats: CoreStats,
  targets: readonly T[],
  isDefending: (target: T) => boolean,
  rng: Rng,
  logs: LogEntry[],
  pendingReorders: PendingReorder[],
): void {
  const elementTag = formatElementTag(skill.element);
  for (const target of targets) {
    if (target.hp <= 0) continue;
    const { crit, damage } = resolveSkillHit(
      rng,
      skill,
      casterStats,
      isDefending(target),
    );
    const finalDamage = applyVulnerability(target, damage);
    target.hp = Math.max(0, target.hp - finalDamage);
    logs.push(
      entry(
        `${casterName} casts ${skill.name} on ${target.name} for ${finalDamage}${elementTag}${crit ? " - crit!" : ""}!`,
        "damage",
        { element: skill.element ?? "physical" },
      ),
    );
    if (target.hp === 0)
      logs.push(entry(`${target.name} is defeated!`, "damage"));
    rollAppliesEffects(target, skill.applies, rng, logs, pendingReorders);
  }
}

// Applies a heal-kind skill to each resolved (ally-side) target in turn.
// Only ever called with the party pool: heal-kind shapes always target the
// caster's own side, and only party members cast heal-kind skills today
// (chooseMonsterSkill filters monsters to attack-kind skills only).
function castHealSkill(
  skill: SkillDef,
  casterName: string,
  casterStats: CoreStats,
  targets: readonly PartyMember[],
  logs: LogEntry[],
): void {
  const heal = skill.power + skillStatValue(skill, casterStats);
  for (const target of targets) {
    target.hp = Math.min(target.maxHp, target.hp + heal);
    const targetPhrase = target.name === casterName ? "" : ` on ${target.name}`;
    logs.push(
      entry(
        `${casterName} casts ${skill.name}${targetPhrase} and recovers ${heal} HP.`,
      ),
    );
    // Heal-cleanse decision (documented in src/engine/combat/skills.ts):
    // every Heal-kind skill also scrubs the healed target's own status
    // effects, rewarding the MP spend with a full reset that a
    // single-status cure item does not offer.
    const cleansed = cleanseAllEffects(target);
    if (cleansed.length > 0) {
      logs.push(
        entry(`${target.name} is cleansed of ${describeCured(cleansed)}!`),
      );
    }
  }
}

// Monster ability use (ENG-28): a monster with an attack-kind skill in its
// list always casts one (uniformly chosen when it has several) instead of
// a basic attack, through the same castOffensiveSkill/resolveShapeTargets
// path a party member's BattleSkill command uses.
function chooseMonsterSkill(
  enemy: BattleEnemy,
  rng: Rng,
): SkillDef | undefined {
  const monsterDef = findMonster(enemy.defId);
  if (!monsterDef?.skills || monsterDef.skills.length === 0) return undefined;
  const attackSkills = resolveSkillList(monsterDef.skills).filter(
    (skill) => skill.kind === "attack",
  );
  if (attackSkills.length === 0) return undefined;
  return rng.pick(attackSkills);
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
    case "attack": {
      const explicitTarget = findAliveEnemy(enemies, command.targetId);
      if (explicitTarget) return isMeleeTargetable(enemies, explicitTarget);
      return enemies.some(
        (enemy) => enemy.hp > 0 && isMeleeTargetable(enemies, enemy),
      );
    }
    case "skill": {
      const skill = findSkill(command.skillId);
      return !!skill && actor.mp >= skill.mpCost;
    }
    case "item": {
      const owned = inventory.find((entry) => entry.itemId === command.itemId);
      return (
        !!owned && owned.quantity > 0 && isUsableBattleItem(command.itemId)
      );
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
  target: EffectCarrier,
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

// Cure items and Heal-cleanse (see the "skill" case below) both remove
// effect instances outright rather than ticking them out naturally.
function removeEffects(
  target: EffectCarrier,
  effectIds: readonly StatusEffectId[],
): StatusEffectId[] {
  if (!target.effects || target.effects.length === 0) return [];
  const removed: StatusEffectId[] = [];
  const remaining = target.effects.filter((effect) => {
    if (!effectIds.includes(effect.effectId)) return true;
    removed.push(effect.effectId);
    return false;
  });
  if (remaining.length > 0) {
    target.effects = remaining;
  } else {
    delete target.effects;
  }
  return removed;
}

function cleanseAllEffects(target: EffectCarrier): StatusEffectId[] {
  if (!target.effects || target.effects.length === 0) return [];
  return removeEffects(
    target,
    target.effects.map((effect) => effect.effectId),
  );
}

function describeCured(cured: readonly StatusEffectId[]): string {
  return cured
    .map((effectId) => findStatusEffect(effectId)?.name ?? effectId)
    .join(" and ");
}

function formatElementTag(element: Element | undefined): string {
  return element && element !== "physical" ? ` (${element})` : "";
}

function rollAppliesEffects(
  target: EffectCarrier,
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
  element: Element | undefined,
): EffectInstance | null {
  logs.push(
    entry(`${actorName} takes ${damage} ${effectName} damage!`, "damage", {
      element,
    }),
  );

  const nextDuration = effect.duration - 1;

  if (nextDuration <= 0) {
    logs.push(entry(`${effectName} wears off of ${actorName}.`, "system"));
    return null;
  }

  return { ...effect, duration: nextDuration };
}

function tickEffects(actor: EffectCarrier, logs: LogEntry[]): void {
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
        def.element,
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
  actor: EffectCarrier,
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

function applyVulnerability(target: EffectCarrier, damage: number): number {
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
  party: PartyMember[],
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
      const explicitTarget = findAliveEnemy(enemies, command.targetId);
      const target =
        explicitTarget && isMeleeTargetable(enemies, explicitTarget)
          ? explicitTarget
          : firstMeleeTarget(enemies);
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
              { element: "physical" },
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
        const targets = resolveShapeTargets(
          skill.target,
          enemies,
          command.targetId,
          rng,
          skill.hitCount,
        );
        castOffensiveSkill(
          skill,
          actor.name,
          actorStats,
          targets,
          () => false,
          rng,
          logs,
          pendingReorders,
        );
      } else {
        const targets = resolveShapeTargets(
          skill.target,
          party,
          command.targetId,
          rng,
          skill.hitCount,
        );
        castHealSkill(skill, actor.name, actorStats, targets, logs);
      }
      break;
    }
    case "item": {
      const heal = healAmount(command.itemId);
      const cures = curedEffects(command.itemId);
      const name = findShopItem(command.itemId)?.name ?? command.itemId;
      if (heal > 0) {
        actor.hp = Math.min(actor.maxHp, actor.hp + heal);
        itemUsed = command.itemId;
        logs.push(entry(`${actor.name} uses ${name} and recovers ${heal} HP.`));
      } else if (cures.length > 0) {
        itemUsed = command.itemId;
        const removed = removeEffects(actor, cures);
        if (removed.length > 0) {
          logs.push(
            entry(
              `${actor.name} uses ${name} and is cured of ${describeCured(removed)}!`,
            ),
          );
        } else {
          logs.push(
            entry(`${actor.name} uses ${name}, but there was nothing to cure.`),
          );
        }
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

    const skill = chooseMonsterSkill(enemy, rng);
    if (skill) {
      const anchor = rng.pick(living);
      const targets = resolveShapeTargets(
        skill.target,
        party,
        anchor.id,
        rng,
        skill.hitCount,
      );
      castOffensiveSkill(
        skill,
        enemy.name,
        enemy.stats,
        targets,
        (target) => defendingIds.has(target.id),
        rng,
        logs,
        pendingReorders,
      );
    } else {
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
            { element: attackElement ?? "physical" },
          ),
        );

        rollAppliesEffects(target, attackApplies, rng, logs, pendingReorders);
      }
    }

    if (party.every((m) => m.hp <= 0)) {
      return { status: "lost", nextActorId: null };
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
  const dungeonId = state.dungeonState
    ? dungeonDefFor(state.dungeonState.dungeonId).id
    : null;
  const rng = new Rng(state.seed, rngState);
  const questAdvance = advanceQuestsOnVictory(
    state.quests,
    state.questItems,
    enemies,
    wasBossVictory,
    dungeonId,
    rng,
  );
  const finalRngState = rng.getState();
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
  finalLogs.push(...questAdvance.logs);

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
  // Loot log lines (ENG-20): kept items rendered with their rarity color,
  // plus a dismantle summary when the filter discarded anything. Shared with
  // `openChest`'s pickup site via `lootLogEntries`.
  const lootOutcomeLogs = lootLogEntries(pickup.outcome);
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
  // Persistent clear record, keyed by the def's real id so it survives the
  // ROG-90 entrance remap. Distinct from dungeonState.cleared above, which
  // only tracks the current session's run. `state.log.length` stands in for
  // a turn counter: it's already deterministic and monotonic per playthrough.
  const clearedAt =
    wasBossVictory && state.dungeonState
      ? {
          ...state.clearedAt,
          [dungeonDefFor(state.dungeonState.dungeonId).id]: state.log.length,
        }
      : state.clearedAt;
  return {
    ...state,
    rngState: finalRngState,
    scene: bs.returnScene,
    party: finalParty,
    gold: state.gold + goldGain + pickup.outcome.goldGained,
    inventory,
    items: pickup.items,
    nextItemId,
    lastLootOutcome: pickup.outcome,
    quests: questAdvance.quests,
    questItems: questAdvance.questItems,
    pendingLootTriage,
    dungeonState,
    clearedAt,
    battleState: null,
    log: [...state.log, ...finalLogs, ...lootOutcomeLogs, ...triageLogs],
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
    const dungeonContext = state.dungeonState
      ? {
          dungeonId: state.dungeonState.dungeonId,
          floor: state.dungeonState.floor,
        }
      : undefined;
    const result = rollVictoryLoot(
      rng,
      enemies,
      state.nextItemId,
      dungeonContext,
    );
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

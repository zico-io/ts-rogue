/**
 * Tavern recruit generation (ROG-21). Pure and seeded: given an `Rng` and the
 * hero's level, rolls a small pool of randomly-generated recruits built from the
 * class archetypes (`CLASSES`). Each recruit is a full `PartyMember` (so hiring
 * is just moving it into the party), assembled from `createStartingHero` and
 * leveled up with the combat `grantXp`/`xpToNext` curve so its stats come from
 * the class's starting stats + per-level growth. The pool lives on
 * `GameState.recruits` and rerolls on inn rest; hiring is gold-gated by
 * `recruitCost`.
 */

import { CLASSES, findClass } from "../../data/classes";
import { grantXp, xpToNext } from "../combat/resolution";
import type { Rng } from "../rng/rng";
import { createStartingHero, type PartyMember } from "./party";

/** Fantasy given names picked for generated recruits. */
const NAMES: readonly string[] = [
  "Aldric",
  "Bryn",
  "Cael",
  "Dara",
  "Elska",
  "Fenn",
  "Goran",
  "Halla",
  "Ivo",
  "Juna",
  "Kesh",
  "Lyra",
  "Morwen",
  "Nyx",
  "Orin",
  "Perrin",
];

/** Hiring fee scales linearly with a recruit's level. */
export const RECRUIT_COST_PER_LEVEL = 25;

/** Gold cost to hire a recruit of the given level. */
export function recruitCost(level: number): number {
  return RECRUIT_COST_PER_LEVEL * level;
}

/** Level a fresh level-1 member up to `target` using the shared XP curve. */
function levelTo(member: PartyMember, target: number): PartyMember {
  let current = member;
  while (current.level < target) {
    current = grantXp(current, xpToNext(current.level)).member;
  }
  return current;
}

/**
 * Roll 2-3 recruits near `heroLevel`. Deterministic for a given `Rng` state.
 * Recruit ids are transient (`recruit-<i>`); the hire reducer reassigns a
 * party-unique id when the recruit joins.
 */
export function generateRecruits(rng: Rng, heroLevel: number): PartyMember[] {
  const count = rng.int(2, 3);
  const recruits: PartyMember[] = [];
  for (let i = 0; i < count; i++) {
    const cls = rng.pick(CLASSES);
    const name = rng.pick(NAMES);
    const level = Math.max(1, heroLevel + rng.int(-1, 1));
    const base = createStartingHero(cls.id, `recruit-${i}`, name);
    recruits.push(levelTo(base, level));
  }
  return recruits;
}

/** Class display name for a recruit's class id (falls back to the raw id). */
export function recruitClassName(classId: string): string {
  return findClass(classId)?.name ?? classId;
}

import { CLASSES, findClass } from "../../data/classes";
import { grantXp, xpToNext } from "../combat/resolution";
import type { Rng } from "../rng/rng";
import { createStartingHero, type PartyMember } from "./party";

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

export const RECRUIT_COST_PER_LEVEL = 25;

export function recruitCost(level: number): number {
  return RECRUIT_COST_PER_LEVEL * level;
}

function levelTo(member: PartyMember, target: number): PartyMember {
  let current = member;
  while (current.level < target) {
    current = grantXp(current, xpToNext(current.level)).member;
  }
  return current;
}

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

export function recruitClassName(classId: string): string {
  return findClass(classId)?.name ?? classId;
}

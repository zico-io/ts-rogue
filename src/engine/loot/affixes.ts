/**
 * Affix rolling (PROJECT_PLAN Phase 5, ROG-11). Pure, seeded helpers that turn
 * a rarity and an item level into rolled prefix/suffix affixes. All randomness
 * routes through the seeded `Rng` so a drop is reproducible from the seed plus
 * the event history. Caps are per rarity (common = none, magic = 1/1, rare and
 * unique = up to 3/3, per section 6). Signature affixes (id prefix `sig-`) are
 * never rolled from the pool - they attach explicitly as a monster-implicit
 * item's fixed implicit, so they are excluded from the eligible pool here.
 */

import { AFFIXES, findAffix } from "../../data/affixes";
import type { Rng } from "../rng/rng";
import type { AffixDef, AffixKind, Rarity, RolledAffix } from "./types";

/** Maximum prefix/suffix counts per rarity (section 6). */
export const RARITY_AFFIX_CAPS: Record<
  Rarity,
  { prefix: number; suffix: number }
> = {
  common: { prefix: 0, suffix: 0 },
  magic: { prefix: 1, suffix: 1 },
  rare: { prefix: 3, suffix: 3 },
  unique: { prefix: 3, suffix: 3 },
};

/** Affixes eligible to roll onto an item of `ilvl` for the given kind. */
export function eligibleAffixes(
  ilvl: number,
  kind: AffixKind,
): readonly AffixDef[] {
  return AFFIXES.filter(
    (affix) =>
      affix.kind === kind && affix.ilvl <= ilvl && !affix.id.startsWith("sig-"),
  );
}

function weightedPickAffix(rng: Rng, eligible: readonly AffixDef[]): AffixDef {
  const total = eligible.reduce((sum, affix) => sum + affix.weight, 0);
  if (total <= 0)
    throw new Error("weightedPickAffix called with zero total weight");
  let r = rng.next() * total;
  for (const affix of eligible) {
    r -= affix.weight;
    if (r < 0) return affix;
  }
  return eligible[eligible.length - 1];
}

function rollSlotAffixes(
  rng: Rng,
  kind: AffixKind,
  cap: number,
  ilvl: number,
  usedIds: Set<string>,
): RolledAffix[] {
  if (cap <= 0) return [];
  const count = rng.int(1, cap);
  const out: RolledAffix[] = [];
  for (let i = 0; i < count; i++) {
    const eligible = eligibleAffixes(ilvl, kind).filter(
      (affix) => !usedIds.has(affix.id),
    );
    if (eligible.length === 0) break;
    const pick = weightedPickAffix(rng, eligible);
    usedIds.add(pick.id);
    out.push({ affixId: pick.id, value: rng.int(pick.min, pick.max) });
  }
  return out;
}

/**
 * Roll prefixes and suffixes for an item of `ilvl` and `rarity`. Consumes a
 * deterministic, seed-driven sequence of `Rng` rolls (one count roll per
 * non-empty slot, then one pick plus one value roll per affix). Pure.
 */
export function rollAffixes(
  rng: Rng,
  ilvl: number,
  rarity: Rarity,
): { prefixes: RolledAffix[]; suffixes: RolledAffix[] } {
  const caps = RARITY_AFFIX_CAPS[rarity];
  const usedIds = new Set<string>();
  const prefixes = rollSlotAffixes(rng, "prefix", caps.prefix, ilvl, usedIds);
  const suffixes = rollSlotAffixes(rng, "suffix", caps.suffix, ilvl, usedIds);
  return { prefixes, suffixes };
}

/** Roll the value of a fixed signature implicit affix (always the given id). */
export function rollImplicitAffix(rng: Rng, affixId: string): RolledAffix {
  const def = findAffix(affixId);
  if (!def) throw new Error(`unknown implicit affix "${affixId}"`);
  return { affixId, value: rng.int(def.min, def.max) };
}

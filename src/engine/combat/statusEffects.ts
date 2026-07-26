/**
 * Status effect definitions (ENG-9 status + element foundation; data model
 * only in ENG-10). Plain UI-free data describing the nine status effects
 * skills/monster attacks will eventually be able to apply. Nothing in the
 * engine reads these yet - resolution wiring, per-turn ticking, cures, and UI
 * are follow-up work (ENG-11, ENG-12, ENG-13). The flags below (`skipsTurn`,
 * `damagePerTurn`, `initiativePenalty`, vulnerability flags) are metadata for
 * that later wiring to key off; they have no effect by themselves.
 *
 * House convention (matches `findSkill`/`findMonster`/`findClass`): a const
 * array plus a `findX(id)` lookup that returns `undefined` for an unknown id.
 */

export type StatusEffectId =
  | "poison"
  | "burn"
  | "stun"
  | "slow"
  | "wet"
  | "oiled"
  | "chilled"
  | "frozen"
  | "shocked";

/** Per-turn damage shape; `frontLoaded` marks damage that is heavier on the first tick (e.g. burn). */
export interface DamagePerTurn {
  amount: number;
  frontLoaded?: boolean;
}

export interface StatusEffectDef {
  id: StatusEffectId;
  name: string;
  /** True when the afflicted actor's turn is skipped entirely (stun, frozen). */
  skipsTurn?: boolean;
  /** Per-turn damage dealt while the effect is active (poison, burn). */
  damagePerTurn?: DamagePerTurn;
  /** Flat SPD/initiative penalty applied while active (slow, chilled). */
  initiativePenalty?: number;
  /** Extra damage taken from a shatter-style follow-up while frozen. */
  shatterVulnerable?: boolean;
  /** Extra damage taken from any source while shocked. */
  damageVulnerable?: boolean;
}

export const STATUS_EFFECTS: readonly StatusEffectDef[] = [
  {
    id: "poison",
    name: "Poison",
    damagePerTurn: { amount: 3 },
  },
  {
    id: "burn",
    name: "Burn",
    // Front-loaded: heavier damage on the first tick, tapering afterward.
    damagePerTurn: { amount: 5, frontLoaded: true },
  },
  {
    id: "stun",
    name: "Stun",
    skipsTurn: true,
  },
  {
    id: "slow",
    name: "Slow",
    initiativePenalty: 3,
  },
  {
    id: "wet",
    name: "Wet",
  },
  {
    id: "oiled",
    name: "Oiled",
  },
  {
    id: "chilled",
    name: "Chilled",
    initiativePenalty: 2,
  },
  {
    id: "frozen",
    name: "Frozen",
    skipsTurn: true,
    shatterVulnerable: true,
  },
  {
    id: "shocked",
    name: "Shocked",
    // Stun-lite: not a full skipped turn, just a damage vulnerability window;
    // the exact behavior is decided by the resolution wiring in ENG-11+.
    damageVulnerable: true,
  },
];

export function findStatusEffect(id: string): StatusEffectDef | undefined {
  return STATUS_EFFECTS.find((effect) => effect.id === id);
}

/**
 * An active status effect on a battle actor (party member or enemy). Plain
 * serializable data; `duration` is remaining turns and `potency` scales
 * per-turn effects like poison/burn damage. Added as an optional array field
 * on battle-scoped actor state in this issue - nothing applies, ticks, or
 * reads it yet.
 */
export interface EffectInstance {
  effectId: StatusEffectId;
  duration: number;
  potency: number;
  /**
   * The original duration when the effect was first applied. Used for
   * computing front-loaded damage curves (e.g. burn) where early ticks
   * deal more damage than later ones. Optional for backward compat with
   * older saves that serialised EffectInstance before this field existed.
   */
  initialDuration?: number;
}

/**
 * A chance for a skill/monster attack to inflict a status effect on hit.
 * Declared on `SkillDef.applies` / a monster's attack; resolution wiring
 * (ENG-11+) will roll `chance` and, on success, push an `EffectInstance` with
 * this `duration` onto the target. Not read anywhere yet.
 */
export interface AppliedEffect {
  effectId: StatusEffectId;
  /** Probability in [0, 1] that a connecting hit applies the effect. */
  chance: number;
  duration: number;
}

/** Damage elements a skill/monster attack can carry; defaults to `physical`. */
export type Element = "physical" | "fire" | "ice" | "lightning" | "poison";

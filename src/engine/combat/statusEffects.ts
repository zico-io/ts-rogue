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

export interface DamagePerTurn {
  amount: number;
  frontLoaded?: boolean;
}

export type Element = "physical" | "fire" | "ice" | "lightning" | "poison";

export interface StatusEffectDef {
  id: StatusEffectId;
  name: string;

  skipsTurn?: boolean;

  damagePerTurn?: DamagePerTurn;

  // The element of the tick-damage log line (e.g. burn reads as fire
  // damage). Effects with no inherent element (stun, slow, the conductor
  // states) leave this unset.
  element?: Element;

  initiativePenalty?: number;

  shatterVulnerable?: boolean;

  damageVulnerable?: boolean;

  skipChance?: number;
}

export const STATUS_EFFECTS: readonly StatusEffectDef[] = [
  {
    id: "poison",
    name: "Poison",
    damagePerTurn: { amount: 3 },
    element: "poison",
  },
  {
    id: "burn",
    name: "Burn",

    damagePerTurn: { amount: 5, frontLoaded: true },
    element: "fire",
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

    damageVulnerable: true,
    skipChance: 0.5,
  },
];

export function findStatusEffect(id: string): StatusEffectDef | undefined {
  return STATUS_EFFECTS.find((effect) => effect.id === id);
}

export interface EffectInstance {
  effectId: StatusEffectId;
  duration: number;
  potency: number;

  initialDuration?: number;
}

export interface AppliedEffect {
  effectId: StatusEffectId;

  chance: number;
  duration: number;
}

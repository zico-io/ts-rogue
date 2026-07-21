import type { Scene } from "../state/types";

/** Core four-stat block shared by party members and monsters. */
export interface CoreStats {
  str: number;
  agi: number;
  vit: number;
  int: number;
}

/** A single enemy instance in battle (plain serializable data). */
export interface BattleEnemy {
  /** Unique per-battle instance id, e.g. `slime-1`. */
  id: string;
  /** Monster definition id this instance was spawned from. */
  defId: string;
  name: string;
  hp: number;
  maxHp: number;
  stats: CoreStats;
  /** Copy of the monster's first-person ASCII art so a save is self-contained. */
  ascii: readonly string[];
  /** Copy of the monster's accent color; optional so older saves load (ROG-31). */
  color?: string;
  xp: number;
  gold: number;
}

export type BattleStatus = "ongoing" | "won" | "lost" | "fled";

/**
 * The mutable slice of `GameState` that tracks an active battle. Plain
 * serializable data only: the enemy group (each with current HP and a copy of
 * its first-person ASCII art), the fixed initiative order reused each round,
 * whether the player must choose an action, the scene to return to on victory
 * or a successful flee, and the battle's resolution status. Hero HP/MP are not
 * duplicated here - they live on `state.party` and are read/written by the
 * combat reducer - so a save/reload never disagrees.
 */
export interface BattleState {
  enemies: BattleEnemy[];
  status: BattleStatus;
  /** Combatant ids in initiative order; rolled once and reused every round. */
  initiative: string[];
  /** True when the battle is ongoing and the player must pick an action. */
  awaitingCommand: boolean;
  /** Scene to return to on victory or a successful flee. */
  returnScene: Scene;
}

/** Player-initiated battle events (the battle members of `GameEvent`). */
export type BattleEvent =
  | { type: "BattleAttack"; targetId: string }
  | { type: "BattleSkill"; skillId: string; targetId: string }
  | { type: "BattleItem"; itemId: string; targetId: string }
  | { type: "BattleDefend" }
  | { type: "BattleFlee" };

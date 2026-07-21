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
  xp: number;
  gold: number;
}

export type BattleStatus = "ongoing" | "won" | "lost" | "fled";

/**
 * The mutable slice of `GameState` that tracks an active battle. Plain
 * serializable data only: the enemy group (each with current HP and a copy of
 * its first-person ASCII art), the fixed initiative order reused each round,
 * whether the player must choose an action, the scene to return to on victory
 * or a successful flee, and the battle's resolution status.
 *
 * Pause-per-actor model (ROG-20): a dispatch resolves exactly one acting party
 * member's command, then auto-resolves every intervening enemy (and skipped,
 * KO'd party member) turn in initiative order until either the next living
 * party member comes up - `activeMemberId` is updated to them and the battle
 * pauses again awaiting a command - or the whole party is down (`lost`). This
 * lets several party members each take their own turn without changing the
 * "one command per dispatch" UI contract. Member HP/MP are not duplicated
 * here - they live on `state.party` and are read/written by the combat
 * reducer - so a save/reload never disagrees.
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
  /** Party member id whose turn it is; only meaningful while awaitingCommand. */
  activeMemberId: string;
  /** Party member ids currently in a defensive stance, cleared when they act again. */
  defendingIds: string[];
}

/** Player-initiated battle events (the battle members of `GameEvent`). */
export type BattleEvent =
  | { type: "BattleAttack"; targetId: string }
  | { type: "BattleSkill"; skillId: string; targetId: string }
  | { type: "BattleItem"; itemId: string; targetId: string }
  | { type: "BattleDefend" }
  | { type: "BattleFlee" };

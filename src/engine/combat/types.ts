import type { Scene } from "../state/types";
import type { EffectInstance } from "./statusEffects";

export interface CoreStats {
  str: number;
  agi: number;
  vit: number;
  int: number;
}

export interface BattleEnemy {
  id: string;

  defId: string;
  name: string;
  hp: number;
  maxHp: number;
  stats: CoreStats;

  ascii: readonly string[];

  color?: string;

  sprite?: string;
  xp: number;
  gold: number;

  effects?: EffectInstance[];
}

export type BattleStatus = "ongoing" | "won" | "lost" | "fled";

export interface BattleState {
  enemies: BattleEnemy[];
  status: BattleStatus;

  initiative: string[];

  awaitingCommand: boolean;

  returnScene: Scene;

  activeMemberId: string;

  defendingIds: string[];
}

export type BattleEvent =
  | { type: "BattleAttack"; targetId: string }
  | { type: "BattleSkill"; skillId: string; targetId: string }
  | { type: "BattleItem"; itemId: string; targetId: string }
  | { type: "BattleDefend" }
  | { type: "BattleFlee" };

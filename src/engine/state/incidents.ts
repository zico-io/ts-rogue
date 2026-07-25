import type { GameEvent, GameState } from "./types";

export const DEBUG_JOURNAL_LIMIT = 200;

export type IncidentCategory =
  | "boot"
  | "load"
  | "reducer"
  | "invariant"
  | "render"
  | "save"
  | "clear"
  | "unhandled-rejection"
  | "uncaught-exception"
  | "manual"
  // Browser-renderer boot phases (ROG-48): the atlas smoke test and the
  // overworld/battle Pixi view setup, each wrapped in its own try/catch in
  // `src/web/main.ts` so one scene's setup failure doesn't block the others.
  | "atlas"
  | "overworld-view"
  | "battle-view"
  | "dungeon-view";

export interface StateSummary {
  scene: string;
  gold: number;
  party: string;
  inventory: number;
  items: number;
  dungeon: number | null;
  battle: string | null;
}

export interface DebugJournalEntry {
  at: string;
  kind: "dispatch" | "failure" | "invariant";
  event?: string;
  before?: StateSummary;
  after?: StateSummary;
  message?: string;
}

export interface GameIncident {
  category: IncidentCategory;
  message: string;
  stack?: string;
  triggeringEvent?: string;
  fingerprint: string;
  fatal: boolean;
  occurredAt: string;
  state: GameState;
  journal: readonly DebugJournalEntry[];
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function attempt<T>(operation: () => T): Attempt<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error };
  }
}

export class StateInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateInvariantError";
  }
}

function requireObject(value: unknown, name: string): asserts value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StateInvariantError(`${name} is required`);
  }
}

function requireArray(
  value: unknown,
  name: string,
): asserts value is unknown[] {
  if (!Array.isArray(value))
    throw new StateInvariantError(`${name} is required`);
}

function nonNegative(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new StateInvariantError(`${name} must be finite and non-negative`);
  }
}

function finite(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StateInvariantError(`${name} must be finite`);
  }
}

function itemIds(state: GameState): string[] {
  const ids = state.items.map((item) => item.instanceId);
  for (const member of state.party) {
    for (const item of Object.values(member.equipment)) {
      if (item) ids.push(item.instanceId);
    }
  }
  return ids;
}

/** Validate the serializable state boundary before it becomes live state. */
export function validateGameState(value: unknown): asserts value is GameState {
  requireObject(value, "GameState");
  const state = value as Partial<GameState>;
  finite(state.seed, "seed");
  requireArray(state.rngState, "rngState");
  for (const [index, value] of state.rngState.entries()) {
    finite(value, `rngState[${index}]`);
  }
  if (
    !["village", "overworld", "dungeon", "battle"].includes(state.scene ?? "")
  ) {
    throw new StateInvariantError("scene is invalid");
  }
  requireArray(state.log, "log");
  requireArray(state.party, "party");
  if (state.party.length === 0)
    throw new StateInvariantError("party is required");
  requireArray(state.inventory, "inventory");
  requireArray(state.items, "items");
  requireArray(state.activatedWaypoints, "activatedWaypoints");
  requireObject(state.worldState, "worldState");
  requireObject(state.flags, "flags");
  if (
    typeof state.flags.permadeath !== "boolean" ||
    typeof state.flags.gameOver !== "boolean"
  ) {
    throw new StateInvariantError("flags are invalid");
  }
  nonNegative(state.gold, "gold");
  nonNegative(state.nextItemId, "nextItemId");
  if (!Number.isInteger(state.nextItemId)) {
    throw new StateInvariantError("nextItemId must be an integer");
  }
  finite(state.worldState.player.x, "worldState.player.x");
  finite(state.worldState.player.y, "worldState.player.y");
  nonNegative(state.worldState.encounterMeter, "encounterMeter");

  for (const [index, member] of state.party.entries()) {
    requireObject(member, `party[${index}]`);
    requireObject(member.stats, `party[${index}].stats`);
    requireObject(member.equipment, `party[${index}].equipment`);
    for (const key of ["level", "xp", "maxHp", "maxMp"] as const) {
      nonNegative(member[key], `party[${index}].${key}`);
    }
    for (const key of ["str", "agi", "vit", "int"] as const) {
      nonNegative(member.stats[key], `party[${index}].stats.${key}`);
    }
    nonNegative(member.hp, `party[${index}].hp`);
    nonNegative(member.mp, `party[${index}].mp`);
    if (member.hp > member.maxHp || member.mp > member.maxMp) {
      throw new StateInvariantError(
        `party[${index}] HP/MP exceeds its maximum`,
      );
    }
  }

  for (const [index, item] of state.inventory.entries()) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new StateInvariantError(
        `inventory[${index}].quantity must be a positive integer`,
      );
    }
  }
  const ids = itemIds(state as GameState);
  if (new Set(ids).size !== ids.length) {
    throw new StateInvariantError("item instance IDs must be unique");
  }
  if (state.battleState) {
    requireArray(state.battleState.enemies, "battleState.enemies");
    for (const [index, enemy] of state.battleState.enemies.entries()) {
      nonNegative(enemy.hp, `battleState.enemies[${index}].hp`);
      nonNegative(enemy.maxHp, `battleState.enemies[${index}].maxHp`);
      nonNegative(enemy.xp, `battleState.enemies[${index}].xp`);
      nonNegative(enemy.gold, `battleState.enemies[${index}].gold`);
      if (enemy.hp > enemy.maxHp) {
        throw new StateInvariantError(
          `battleState.enemies[${index}].hp exceeds maxHp`,
        );
      }
    }
  }

  try {
    const json = JSON.stringify(state, (_key, entry) => {
      if (typeof entry === "number" && !Number.isFinite(entry)) {
        throw new Error("non-finite number");
      }
      if (
        typeof entry === "bigint" ||
        typeof entry === "function" ||
        typeof entry === "symbol" ||
        entry === undefined
      ) {
        throw new Error(`unsupported ${typeof entry}`);
      }
      return entry;
    });
    JSON.parse(json);
  } catch (error) {
    throw new StateInvariantError(
      `GameState is not serializable: ${errorMessage(error)}`,
    );
  }
}

export function summarizeState(state: GameState): StateSummary {
  return {
    scene: state.scene,
    gold: state.gold,
    party: state.party
      .map(
        (member) => `${member.id}:${member.hp}/${member.maxHp}:${member.level}`,
      )
      .join(","),
    inventory: state.inventory.reduce(
      (total, item) => total + item.quantity,
      0,
    ),
    items: itemIds(state).length,
    dungeon: state.dungeonState?.floor ?? null,
    battle: state.battleState?.status ?? null,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function topStackFrame(stack?: string): string {
  return (
    stack
      ?.split("\n")
      .find((line) => line.trim().startsWith("at "))
      ?.trim() ?? ""
  );
}

/** Stable FNV-1a fingerprint over category, normalized message, and top frame. */
export function incidentFingerprint(
  category: IncidentCategory,
  error: unknown,
): string {
  const message = errorMessage(error).trim().replace(/\s+/g, " ").toLowerCase();
  const stack = error instanceof Error ? error.stack : undefined;
  const input = `${category}\n${message}\n${topStackFrame(stack)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `inc-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function eventName(event?: GameEvent): string | undefined {
  return event?.type;
}

export function createGameIncident(
  category: IncidentCategory,
  error: unknown,
  state: GameState,
  journal: readonly DebugJournalEntry[],
  fatal: boolean,
  triggeringEvent?: string,
): GameIncident {
  return {
    category,
    message: errorMessage(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    ...(triggeringEvent ? { triggeringEvent } : {}),
    fingerprint: incidentFingerprint(category, error),
    fatal,
    occurredAt: new Date().toISOString(),
    state,
    journal,
  };
}

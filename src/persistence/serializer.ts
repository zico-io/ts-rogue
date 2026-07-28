import { DEFAULT_CLASS_ID } from "../data/classes";
import { dungeonDefFor } from "../data/dungeons";
import { EMPTY_LOOT_FILTER } from "../engine/loot/lootFilter";
import type { GameState, LogEntry } from "../engine/state/types";

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const state = JSON.parse(json) as GameState;
  state.log = (state.log as readonly (string | LogEntry)[]).map((line) =>
    typeof line === "string" ? { text: line, kind: "system" } : line,
  );
  if (!state.flags) {
    state.flags = { permadeath: false, gameOver: false };
  }
  if (state.dungeonState && state.dungeonState.cleared === undefined) {
    state.dungeonState.cleared = false;
  }
  if (state.dungeonState && state.dungeonState.theme === undefined) {
    state.dungeonState.theme = dungeonDefFor(
      state.dungeonState.dungeonId,
    ).theme;
  }
  for (const member of state.party) {
    if (!member.classId) member.classId = DEFAULT_CLASS_ID;
  }
  if (!state.recruits) state.recruits = [];
  // No retroactive points for levels reached before skill trees shipped
  // (ENG-32) - old members simply start at zero points and no unlocks.
  for (const member of [...state.party, ...state.recruits]) {
    if (member.skillPoints === undefined) member.skillPoints = 0;
    if (!member.unlockedNodes) member.unlockedNodes = [];
  }
  if (!state.activatedWaypoints) state.activatedWaypoints = ["village"];
  if (!state.stash) state.stash = [];
  if (state.pendingLootTriage === undefined) state.pendingLootTriage = null;
  if (!state.lootFilter) state.lootFilter = EMPTY_LOOT_FILTER;
  if (state.lastLootOutcome === undefined) state.lastLootOutcome = null;
  if (!state.clearedAt) state.clearedAt = {};
  if (!state.shopStock) state.shopStock = [];
  if (!state.quests) {
    state.quests = { available: [], accepted: [], completedIds: [] };
  }
  if (!state.questItems) state.questItems = {};
  return state;
}

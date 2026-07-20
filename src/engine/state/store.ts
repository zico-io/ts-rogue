import { findShopItem, sellPriceFor } from "../../data/shops.js";
import { createStartingHero } from "../entities/party.js";
import { Rng } from "../rng/rng.js";
import {
  biomeDanger,
  createInitialWorldState,
  ENCOUNTER_THRESHOLD,
  generateOverworldMap,
  inBounds,
  isPassable,
  tileAt,
} from "../world/overworld.js";
import type { GameEvent, GameState, MoveDelta } from "./types.js";

/** Gold cost per party member to fully heal at the inn. */
export const INN_COST_PER_MEMBER = 10;

/** Build a fresh state tree for a new run from a seed, logging the seed. */
export function newGame(seed: number): GameState {
  const rng = new Rng(seed);
  const map = generateOverworldMap(seed);
  return {
    seed,
    rngState: rng.getState(),
    scene: "village",
    log: [`Started new game with seed ${seed}`],
    party: [createStartingHero()],
    gold: 50,
    inventory: [],
    worldState: createInitialWorldState(map),
  };
}

function innHeal(state: GameState): GameState {
  const cost = state.party.length * INN_COST_PER_MEMBER;
  if (state.gold < cost) {
    return {
      ...state,
      log: [...state.log, "Not enough gold to rest at the inn"],
    };
  }
  return {
    ...state,
    gold: state.gold - cost,
    party: state.party.map((member) => ({
      ...member,
      hp: member.maxHp,
      mp: member.maxMp,
    })),
    log: [...state.log, `Healed the party for ${cost} gold`],
  };
}

function storeBuy(
  state: GameState,
  itemId: string,
  quantity: number,
): GameState {
  const item = findShopItem(itemId);
  if (!item || quantity <= 0) {
    return {
      ...state,
      log: [...state.log, `Cannot buy unknown item "${itemId}"`],
    };
  }
  const cost = item.price * quantity;
  if (state.gold < cost) {
    return {
      ...state,
      log: [...state.log, `Not enough gold to buy ${quantity} ${item.name}`],
    };
  }
  const existing = state.inventory.find((entry) => entry.itemId === itemId);
  const inventory = existing
    ? state.inventory.map((entry) =>
        entry.itemId === itemId
          ? { ...entry, quantity: entry.quantity + quantity }
          : entry,
      )
    : [...state.inventory, { itemId, quantity }];
  return {
    ...state,
    gold: state.gold - cost,
    inventory,
    log: [...state.log, `Bought ${quantity} ${item.name} for ${cost} gold`],
  };
}

function storeSell(
  state: GameState,
  itemId: string,
  quantity: number,
): GameState {
  const item = findShopItem(itemId);
  const owned = state.inventory.find((entry) => entry.itemId === itemId);
  if (!item || quantity <= 0 || !owned || owned.quantity < quantity) {
    return {
      ...state,
      log: [...state.log, `Cannot sell unknown or unowned item "${itemId}"`],
    };
  }
  const proceeds = sellPriceFor(item) * quantity;
  const remaining = owned.quantity - quantity;
  const inventory =
    remaining > 0
      ? state.inventory.map((entry) =>
          entry.itemId === itemId ? { ...entry, quantity: remaining } : entry,
        )
      : state.inventory.filter((entry) => entry.itemId !== itemId);
  return {
    ...state,
    gold: state.gold + proceeds,
    inventory,
    log: [...state.log, `Sold ${quantity} ${item.name} for ${proceeds} gold`],
  };
}

/**
 * `MoveOverworld` reducer (PROJECT_PLAN Phase 2, §4.3). The map is
 * regenerated from `state.seed` (a pure function, see `world/overworld.ts`)
 * rather than stored on state. Movement onto an impassable tile or off the
 * map edge is a no-op. Movement onto the village or a dungeon entrance
 * changes scene directly; movement onto any other passable tile accumulates
 * encounter danger (with RNG jitter) and triggers a battle at the threshold.
 * Only successful moves consume RNG, keeping blocked moves fully
 * side-effect-free.
 */
function moveOverworld(
  state: GameState,
  dx: MoveDelta,
  dy: MoveDelta,
): GameState {
  const map = generateOverworldMap(state.seed);
  const target = {
    x: state.worldState.player.x + dx,
    y: state.worldState.player.y + dy,
  };

  if (!inBounds(map, target) || !isPassable(tileAt(map, target))) {
    return {
      ...state,
      log: [...state.log, "The way is blocked"],
    };
  }

  const tile = tileAt(map, target);

  if (tile === "village") {
    return {
      ...state,
      scene: "village",
      worldState: { ...state.worldState, player: target },
      log: [...state.log, "You return to the village"],
    };
  }

  if (tile === "dungeonEntrance") {
    return {
      ...state,
      scene: "dungeon",
      worldState: { ...state.worldState, player: target },
      log: [...state.log, "You step into a dungeon entrance"],
    };
  }

  const rng = new Rng(state.seed, state.rngState);
  const jitter = 0.7 + rng.next() * 0.6;
  const meter = state.worldState.encounterMeter + biomeDanger(tile) * jitter;

  if (meter >= ENCOUNTER_THRESHOLD) {
    return {
      ...state,
      scene: "battle",
      rngState: rng.getState(),
      worldState: { player: target, encounterMeter: 0 },
      log: [...state.log, "A monster ambushes the party!"],
    };
  }

  return {
    ...state,
    rngState: rng.getState(),
    worldState: { player: target, encounterMeter: meter },
  };
}

/** Pure reducer: never mutates `state`. All state transitions route through here. */
export function reduce(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "NewGame":
      return newGame(event.seed);
    case "ChangeScene":
      return { ...state, scene: event.scene };
    case "Log":
      return { ...state, log: [...state.log, event.message] };
    case "InnHeal":
      return innHeal(state);
    case "StoreBuy":
      return storeBuy(state, event.itemId, event.quantity);
    case "StoreSell":
      return storeSell(state, event.itemId, event.quantity);
    case "MoveOverworld":
      return moveOverworld(state, event.dx, event.dy);
  }
}

export type Listener = (state: GameState) => void;

/** Thin UI-facing holder around {@link reduce}. No Ink/React dependency. */
export class GameStore {
  private state: GameState;
  private readonly listeners = new Set<Listener>();

  constructor(initial: GameState) {
    this.state = initial;
  }

  getState(): GameState {
    return this.state;
  }

  dispatch(event: GameEvent): GameState {
    this.state = reduce(this.state, event);
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

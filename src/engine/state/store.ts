import { findShopItem, sellPriceFor } from "../../data/shops.js";
import { createStartingHero } from "../entities/party.js";
import { Rng } from "../rng/rng.js";
import type { GameEvent, GameState } from "./types.js";

/** Gold cost per party member to fully heal at the inn. */
export const INN_COST_PER_MEMBER = 10;

/** Build a fresh state tree for a new run from a seed, logging the seed. */
export function newGame(seed: number): GameState {
  const rng = new Rng(seed);
  return {
    seed,
    rngState: rng.getState(),
    scene: "village",
    log: [`Started new game with seed ${seed}`],
    party: [createStartingHero()],
    gold: 50,
    inventory: [],
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

import { Rng } from "../rng/rng.js";
import type { GameEvent, GameState } from "./types.js";

/** Build a fresh state tree for a new run from a seed, logging the seed. */
export function newGame(seed: number): GameState {
  const rng = new Rng(seed);
  return {
    seed,
    rngState: rng.getState(),
    scene: "village",
    log: [`Started new game with seed ${seed}`],
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

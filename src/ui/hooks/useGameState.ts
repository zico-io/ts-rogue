import { useEffect, useState } from "react";
import type { GameStore } from "../../engine/state/store.js";
import type { GameState } from "../../engine/state/types.js";

/** Subscribes to a {@link GameStore} and re-renders the caller on every dispatch. */
export function useGameState(store: GameStore): GameState {
  const [state, setState] = useState(store.getState());

  useEffect(() => store.subscribe(setState), [store]);

  return state;
}

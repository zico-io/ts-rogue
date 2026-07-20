import { useEffect, useState } from "react";
import type { GameStore } from "../../engine/state/store";
import type { GameState } from "../../engine/state/types";

/** Subscribes a component to a {@link GameStore}, re-rendering on every dispatch. */
export function useGameState(store: GameStore): GameState {
  const [state, setState] = useState(store.getState());

  useEffect(() => store.subscribe(setState), [store]);

  return state;
}

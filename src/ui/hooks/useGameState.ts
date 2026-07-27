import { useEffect, useState } from "react";
import type { GameStore } from "../../engine/state/store";
import type { GameState } from "../../engine/state/types";

export function useGameState(store: GameStore): GameState {
  const [state, setState] = useState(store.getState());

  useEffect(() => store.subscribe(setState), [store]);

  return state;
}

import { useState } from "react";
import type { GameEvent, GameState } from "../../engine/state/types.js";
import { ChurchView } from "./village/ChurchView.js";
import { InnView } from "./village/InnView.js";
import { StoreView } from "./village/StoreView.js";
import type { VillageBuilding } from "./village/types.js";
import { VillageOverview } from "./village/VillageOverview.js";

export interface VillageScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
}

/**
 * Village hub (PROJECT_PLAN Phase 1, ROG-7). Shows the party/gold overview
 * and routes into an Inn/Church/Store sub-view; Esc from a sub-view returns
 * to the overview.
 */
export function VillageScreen({ state, dispatch }: VillageScreenProps) {
  const [building, setBuilding] = useState<VillageBuilding | null>(null);
  const onBack = () => setBuilding(null);

  switch (building) {
    case "inn":
      return <InnView dispatch={dispatch} onBack={onBack} state={state} />;
    case "church":
      return <ChurchView dispatch={dispatch} onBack={onBack} state={state} />;
    case "store":
      return <StoreView dispatch={dispatch} onBack={onBack} state={state} />;
    case null:
      return <VillageOverview onEnter={setBuilding} state={state} />;
  }
}

import { useState } from "react";
import type { GameEvent, GameState } from "../../engine/state/types";
import type { FailureBoundary } from "../../lib/incidents";
import { ChurchView } from "./village/ChurchView";
import { InnView } from "./village/InnView";
import { StashView } from "./village/StashView";
import { StoreView } from "./village/StoreView";
import { TavernView } from "./village/TavernView";
import type { VillageBuilding } from "./village/types";
import { VillageOverview } from "./village/VillageOverview";

export interface VillageScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  failures: FailureBoundary;
}

/**
 * Village hub (PROJECT_PLAN Phase 1, ROG-7). Shows the party/gold overview
 * and routes into an Inn/Church/Store sub-view; Esc from a sub-view returns
 * to the overview. From the overview, leaving town dispatches a scene
 * change to the overworld (PROJECT_PLAN Phase 2, ROG-8).
 */
export function VillageScreen({
  state,
  dispatch,
  failures,
}: VillageScreenProps) {
  const [building, setBuilding] = useState<VillageBuilding | null>(null);
  const onBack = () => setBuilding(null);
  const onLeave = () => dispatch({ type: "ChangeScene", scene: "overworld" });

  switch (building) {
    case "inn":
      return <InnView dispatch={dispatch} onBack={onBack} state={state} />;
    case "church":
      return (
        <ChurchView
          dispatch={dispatch}
          failures={failures}
          onBack={onBack}
          state={state}
        />
      );
    case "store":
      return <StoreView dispatch={dispatch} onBack={onBack} state={state} />;
    case "tavern":
      return <TavernView dispatch={dispatch} onBack={onBack} state={state} />;
    case "stash":
      return <StashView dispatch={dispatch} onBack={onBack} state={state} />;
    case null:
      return (
        <VillageOverview
          onEnter={setBuilding}
          onLeave={onLeave}
          state={state}
        />
      );
  }
}

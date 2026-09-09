import { useState } from "react";
import type { GameEvent, GameState } from "../../engine/state/types";
import type { FailureBoundary } from "../../lib/incidents";
import { ChurchView } from "./village/ChurchView";
import { GuildView } from "./village/GuildView";
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
    case "guild":
      return <GuildView dispatch={dispatch} onBack={onBack} state={state} />;
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

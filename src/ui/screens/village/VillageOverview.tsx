import { Text, useInput } from "ink";
import { useState } from "react";
import type { GameState } from "../../../engine/state/types";
import { Screen } from "../../components/Screen";
import { normalizeInkKey } from "../../hooks/normalizeInkKey";
import { theme } from "../../theme";
import {
  OPTIONS,
  type OverviewUiState,
  reduceOverviewUi,
  resolveOverviewIntent,
} from "./interaction";
import type { VillageBuilding } from "./types";

export interface VillageOverviewProps {
  state: GameState;
  onEnter: (building: VillageBuilding) => void;
  onLeave: () => void;
}

/** Village hub landing view: party/gold summary plus a building/overworld picker. */
export function VillageOverview({
  state,
  onEnter,
  onLeave,
}: VillageOverviewProps) {
  const [overviewUi, setOverviewUi] = useState<OverviewUiState>({
    cursor: 0,
  });

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveOverviewIntent(keyName);
    if (!intent) return;

    const result = reduceOverviewUi(overviewUi, intent);
    switch (result.effect?.type) {
      case "enter":
        onEnter(result.effect.building);
        break;
      case "leave":
        onLeave();
        break;
      default:
        break;
    }
    setOverviewUi(result.state);
  });

  return (
    <Screen
      state={state}
      title="Village"
      hint="Controls: up/down + Enter, or i/c/s/t/x/o to act directly; 1-4 switch scenes; q to quit."
    >
      {OPTIONS.map((option, index) => (
        <Text
          color={index === overviewUi.cursor ? theme.accent : undefined}
          key={option.key}
        >
          {index === overviewUi.cursor ? "> " : "  "}[{option.shortcut}]{" "}
          {option.label}
        </Text>
      ))}
    </Screen>
  );
}

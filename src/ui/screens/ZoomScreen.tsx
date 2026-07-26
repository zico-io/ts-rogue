import { Text, useInput } from "ink";
import { useState } from "react";
import type { GameEvent, GameState } from "../../engine/state/types";
import { generateOverworldMap } from "../../engine/world/overworld";
import { activatedWaypointList } from "../../engine/world/waypoints";
import { Screen } from "../components/Screen";
import { normalizeInkKey } from "../hooks/normalizeInkKey";
import { theme } from "../theme";
import {
  reduceZoomUi,
  resolveZoomIntent,
  type ZoomUiState,
} from "./zoom/interaction";

export interface ZoomScreenProps {
  state: GameState;
  dispatch: (event: GameEvent) => void;
  onClose: () => void;
}

export function ZoomScreen({ state, dispatch, onClose }: ZoomScreenProps) {
  const map = generateOverworldMap(state.seed);
  const waypoints = activatedWaypointList(map, state.activatedWaypoints);
  const [zoomUi, setZoomUi] = useState<ZoomUiState>({ cursor: 0 });

  useInput((input, key) => {
    const keyName = normalizeInkKey(input, key);
    if (!keyName) return;
    const intent = resolveZoomIntent(keyName);
    if (!intent) return;

    const result = reduceZoomUi(zoomUi, intent, { count: waypoints.length });
    switch (result.effect?.type) {
      case "travel":
        dispatch({
          type: "Zoom",
          waypointId: waypoints[result.effect.index].id,
        });
        onClose();
        break;
      case "close":
        onClose();
        break;
      default:
        break;
    }
    setZoomUi(result.state);
  });

  return (
    <Screen
      state={state}
      title="Fast Travel"
      hint="Up/Down to choose, Enter to travel, Esc to cancel."
    >
      {waypoints.length === 0 ? (
        <Text color={theme.textMuted}>(no destinations discovered yet)</Text>
      ) : (
        waypoints.map((waypoint, index) => (
          <Text
            color={index === zoomUi.cursor ? theme.accent : undefined}
            key={waypoint.id}
          >
            {index === zoomUi.cursor ? "> " : "  "}
            {waypoint.label} (tier {waypoint.tier})
          </Text>
        ))
      )}
    </Screen>
  );
}

import type { GameState } from "../../engine/state/types.js";
import { SceneLayout } from "./SceneLayout.js";

export interface SceneScreenProps {
  messages: GameState["messages"];
}

const HINT = "Overworld. Press 1-4 to switch scenes, t for title, q to quit.";

/** Placeholder for the Phase 2 overworld map and traversal. */
export function OverworldScreen({ messages }: SceneScreenProps) {
  return <SceneLayout title="Overworld" hint={HINT} messages={messages} />;
}

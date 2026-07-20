import type { GameState } from "../../engine/state/types.js";
import { SceneLayout } from "./SceneLayout.js";

export interface SceneScreenProps {
  messages: GameState["messages"];
}

const HINT = "Village. Press 1-4 to switch scenes, t for title, q to quit.";

/** Placeholder for the Phase 1 village hub (Inn/Church/Store). */
export function VillageScreen({ messages }: SceneScreenProps) {
  return <SceneLayout title="Village" hint={HINT} messages={messages} />;
}

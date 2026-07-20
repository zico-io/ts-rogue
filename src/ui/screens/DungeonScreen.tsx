import type { GameState } from "../../engine/state/types.js";
import { SceneLayout } from "./SceneLayout.js";

export interface SceneScreenProps {
  messages: GameState["messages"];
}

const HINT = "Dungeon. Press 1-4 to switch scenes, t for title, q to quit.";

/** Placeholder for the Phase 3 first-person dungeon crawler. */
export function DungeonScreen({ messages }: SceneScreenProps) {
  return <SceneLayout title="Dungeon" hint={HINT} messages={messages} />;
}

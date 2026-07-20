import type { GameState } from "../../engine/state/types.js";
import { SceneLayout } from "./SceneLayout.js";

export interface SceneScreenProps {
  messages: GameState["messages"];
}

const HINT = "Battle. Press 1-4 to switch scenes, t for title, q to quit.";

/** Placeholder for the Phase 4 turn-based battle scene. */
export function BattleScreen({ messages }: SceneScreenProps) {
  return <SceneLayout title="Battle" hint={HINT} messages={messages} />;
}

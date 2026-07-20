import type { GameState } from "../../engine/state/types.js";
import { PlaceholderScene } from "./PlaceholderScene.js";

export function DungeonScreen({ state }: { state: GameState }) {
  return <PlaceholderScene label="Dungeon" state={state} />;
}

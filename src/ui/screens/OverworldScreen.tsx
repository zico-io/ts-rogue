import type { GameState } from "../../engine/state/types.js";
import { PlaceholderScene } from "./PlaceholderScene.js";

export function OverworldScreen({ state }: { state: GameState }) {
  return <PlaceholderScene label="Overworld" state={state} />;
}

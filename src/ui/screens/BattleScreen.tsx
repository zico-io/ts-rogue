import type { GameState } from "../../engine/state/types.js";
import { PlaceholderScene } from "./PlaceholderScene.js";

export function BattleScreen({ state }: { state: GameState }) {
  return <PlaceholderScene label="Battle" state={state} />;
}

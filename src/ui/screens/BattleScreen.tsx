import type { GameState } from "../../engine/state/types";
import { PlaceholderScene } from "./PlaceholderScene";

export function BattleScreen({ state }: { state: GameState }) {
  return <PlaceholderScene label="Battle" state={state} />;
}

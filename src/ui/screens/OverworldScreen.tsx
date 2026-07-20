import type { GameState } from "../../engine/state/types";
import { PlaceholderScene } from "./PlaceholderScene";

export function OverworldScreen({ state }: { state: GameState }) {
  return <PlaceholderScene label="Overworld" state={state} />;
}

import type { GameState } from "../../engine/state/types.js";
import { PlaceholderScene } from "./PlaceholderScene.js";

export function VillageScreen({ state }: { state: GameState }) {
  return <PlaceholderScene label="Village" state={state} />;
}

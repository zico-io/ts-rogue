import type { GameState } from "../../engine/state/types";
import { PlaceholderScene } from "./PlaceholderScene";

export function DungeonScreen({ state }: { state: GameState }) {
  return <PlaceholderScene label="Dungeon" state={state} />;
}

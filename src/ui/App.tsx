import { useApp, useInput } from "ink";
import { useState } from "react";
import type { GameStore } from "../engine/state/store.js";
import type { Scene } from "../engine/state/types.js";
import { useGameState } from "./hooks/useGameState.js";
import { BattleScreen } from "./screens/BattleScreen.js";
import { DungeonScreen } from "./screens/DungeonScreen.js";
import { OverworldScreen } from "./screens/OverworldScreen.js";
import { TitleScreen } from "./screens/TitleScreen.js";
import { VillageScreen } from "./screens/VillageScreen.js";

export interface AppProps {
  store: GameStore;
}

/** Scene keys shared by the title screen and every placeholder scene. */
const SCENE_KEYS: Record<string, Scene> = {
  "1": "village",
  "2": "overworld",
  "3": "dungeon",
  "4": "battle",
};

type View = "title" | "scene";

/** Ink root: renders the title screen, then routes between scene placeholders via keypress. */
export function App({ store }: AppProps) {
  const state = useGameState(store);
  const { exit } = useApp();
  const [view, setView] = useState<View>("title");

  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    const scene = SCENE_KEYS[input];
    if (scene) {
      store.dispatch({ type: "ChangeScene", scene });
      setView("scene");
      return;
    }
    if (view === "title" && key.return) {
      setView("scene");
      return;
    }
    if (view === "scene" && input === "t") {
      setView("title");
    }
  });

  if (view === "title") {
    return <TitleScreen seed={state.seed} messages={state.messages} />;
  }

  switch (state.scene) {
    case "village":
      return <VillageScreen messages={state.messages} />;
    case "overworld":
      return <OverworldScreen messages={state.messages} />;
    case "dungeon":
      return <DungeonScreen messages={state.messages} />;
    case "battle":
      return <BattleScreen messages={state.messages} />;
  }
}

import { render, useApp, useInput } from "ink";
import { useState } from "react";
import { GameStore, newGame } from "./engine/state/store.js";
import type { Scene } from "./engine/state/types.js";
import { loadGame } from "./persistence/save.js";
import { useGameState } from "./ui/hooks/useGameState.js";
import { BattleScreen } from "./ui/screens/BattleScreen.js";
import { DungeonScreen } from "./ui/screens/DungeonScreen.js";
import { OverworldScreen } from "./ui/screens/OverworldScreen.js";
import { TitleScreen } from "./ui/screens/TitleScreen.js";
import { VillageScreen } from "./ui/screens/VillageScreen.js";

const sceneKeys: Record<string, Scene> = {
  "1": "village",
  "2": "overworld",
  "3": "dungeon",
  "4": "battle",
};

function isQuit(input: string, key: { ctrl: boolean }): boolean {
  return input === "q" || (key.ctrl && input === "c");
}

function App({ store, hasSave }: { store: GameStore; hasSave: boolean }) {
  const { exit } = useApp();
  const [started, setStarted] = useState(false);
  const state = useGameState(store);

  useInput(
    (input, key) => {
      if (isQuit(input, key)) {
        exit();
        return;
      }
      // A loaded save is already the store's initial state; only a fresh
      // boot with no save needs a new run seeded here.
      if (!hasSave) {
        store.dispatch({ type: "NewGame", seed: Date.now() });
      }
      setStarted(true);
    },
    { isActive: !started },
  );

  useInput(
    (input, key) => {
      if (isQuit(input, key)) {
        exit();
        return;
      }
      const scene = sceneKeys[input];
      if (scene) store.dispatch({ type: "ChangeScene", scene });
    },
    { isActive: started },
  );

  if (!started) return <TitleScreen hasSave={hasSave} />;

  switch (state.scene) {
    case "village":
      return (
        <VillageScreen
          dispatch={(event) => store.dispatch(event)}
          state={state}
        />
      );
    case "overworld":
      return <OverworldScreen state={state} />;
    case "dungeon":
      return <DungeonScreen state={state} />;
    case "battle":
      return <BattleScreen state={state} />;
  }
}

const savedGame = loadGame();
const hasSave = savedGame !== undefined;
const store = new GameStore(savedGame ?? newGame(Date.now()));

render(<App hasSave={hasSave} store={store} />);

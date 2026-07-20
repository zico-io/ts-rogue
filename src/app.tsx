import { render, useApp, useInput } from "ink";
import { useState } from "react";
import { GameStore, newGame } from "./engine/state/store";
import type { Scene } from "./engine/state/types";
import { loadGame } from "./persistence/save";
import { useGameState } from "./ui/hooks/useGameState";
import { BattleScreen } from "./ui/screens/BattleScreen";
import { DungeonScreen } from "./ui/screens/DungeonScreen";
import { OverworldScreen } from "./ui/screens/OverworldScreen";
import { TitleScreen } from "./ui/screens/TitleScreen";
import { VillageScreen } from "./ui/screens/VillageScreen";

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

  const dispatch = (event: Parameters<GameStore["dispatch"]>[0]) =>
    store.dispatch(event);

  switch (state.scene) {
    case "village":
      return <VillageScreen dispatch={dispatch} state={state} />;
    case "overworld":
      return <OverworldScreen dispatch={dispatch} state={state} />;
    case "dungeon":
      return <DungeonScreen dispatch={dispatch} state={state} />;
    case "battle":
      return <BattleScreen dispatch={dispatch} state={state} />;
  }
}

const savedGame = loadGame();
const hasSave = savedGame !== undefined;
const store = new GameStore(savedGame ?? newGame(Date.now()));

render(<App hasSave={hasSave} store={store} />);

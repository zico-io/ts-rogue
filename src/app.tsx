import { Box, render, Text, useApp, useInput } from "ink";
import { useState } from "react";
import { GameStore, newGame } from "./engine/state/store";
import type { Scene } from "./engine/state/types";
import { loadGame } from "./persistence/save";
import { useGameState } from "./ui/hooks/useGameState";
import { BattleScreen } from "./ui/screens/BattleScreen";
import { DevConsole } from "./ui/screens/DevConsole";
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

function App({
  store,
  hasSave,
  devConsoleEnabled,
}: {
  store: GameStore;
  hasSave: boolean;
  devConsoleEnabled: boolean;
}) {
  const { exit } = useApp();
  const [started, setStarted] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const state = useGameState(store);

  useInput((input) => {
    if (devConsoleEnabled && input === "`") {
      setConsoleOpen((open) => !open);
    }
  });

  useInput(
    (input, key) => {
      if (devConsoleEnabled && input === "`") return;
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
    { isActive: !started && !consoleOpen },
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
    { isActive: started && !consoleOpen },
  );

  const dispatch = (event: Parameters<GameStore["dispatch"]>[0]) =>
    store.dispatch(event);

  if (consoleOpen) {
    return (
      <DevConsole
        dispatch={dispatch}
        output={consoleOutput}
        setOutput={setConsoleOutput}
        state={state}
      />
    );
  }

  if (!started) {
    return (
      <Box flexDirection="column">
        <TitleScreen hasSave={hasSave} />
        {devConsoleEnabled && (
          <Text dimColor>Dev console: press ` to switch.</Text>
        )}
      </Box>
    );
  }

  // Each scene renders through the shared Screen frame, which owns the pane fill.
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

render(
  <App
    devConsoleEnabled={process.argv.includes("--dev")}
    hasSave={hasSave}
    store={store}
  />,
  { alternateScreen: true },
);

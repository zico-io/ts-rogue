import { Box, render, Text, useApp, useInput } from "ink";
import { type ReactNode, useEffect, useState } from "react";
import { GameStore, newGame } from "./engine/state/store";
import type { Scene } from "./engine/state/types";
import { clearSave, loadGame } from "./persistence/save";
import {
  MinSizeGuard,
  TerminalLayoutProvider,
  useTerminalLayout,
} from "./ui/components/MinSizeGuard";
import { useGameState } from "./ui/hooks/useGameState";
import { BattleScreen } from "./ui/screens/BattleScreen";
import { DevConsole } from "./ui/screens/DevConsole";
import { DungeonScreen } from "./ui/screens/DungeonScreen";
import { GameOverScreen } from "./ui/screens/GameOverScreen";
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
  const { columns, rows, tooSmall } = useTerminalLayout();
  const [started, setStarted] = useState(false);
  const [modeCursor, setModeCursor] = useState(0);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const state = useGameState(store);
  const gameOver = state.flags?.gameOver ?? false;

  useInput((input) => {
    if (devConsoleEnabled && input === "`") {
      setConsoleOpen((open) => !open);
    }
  });

  // Title screen phase: mode selection on a fresh boot (no save), or any key
  // to continue an existing save (Phase 6, ROG-12 permadeath choice).
  useInput(
    (input, key) => {
      if (devConsoleEnabled && input === "`") return;
      if (isQuit(input, key)) {
        exit();
        return;
      }
      if (hasSave) {
        setStarted(true);
        return;
      }
      if (key.upArrow) {
        setModeCursor((c) => (c === 0 ? 1 : 0));
      } else if (key.downArrow) {
        setModeCursor((c) => (c === 0 ? 1 : 0));
      } else if (key.return) {
        store.dispatch({
          type: "NewGame",
          seed: Date.now(),
          permadeath: modeCursor === 1,
        });
        setStarted(true);
      }
    },
    { isActive: !started && !consoleOpen },
  );

  // In-game scene switching (blocked while the game is over).
  useInput(
    (input, key) => {
      if (isQuit(input, key)) {
        exit();
        return;
      }
      const scene = sceneKeys[input];
      if (scene) store.dispatch({ type: "ChangeScene", scene });
    },
    { isActive: started && !consoleOpen && !gameOver },
  );

  // Game-over phase: Enter starts a new run (same permadeath mode), q quits.
  useInput(
    (input, key) => {
      if (isQuit(input, key)) {
        exit();
        return;
      }
      if (key.return) {
        const permadeath = state.flags?.permadeath ?? false;
        store.dispatch({ type: "NewGame", seed: Date.now(), permadeath });
      }
    },
    { isActive: started && !consoleOpen && gameOver },
  );

  // Clear the persisted save once the game is over so the next boot starts a
  // fresh run. I/O lives in the persistence layer, not the engine.
  useEffect(() => {
    if (gameOver) clearSave();
  }, [gameOver]);

  const dispatch = (event: Parameters<GameStore["dispatch"]>[0]) =>
    store.dispatch(event);

  let content: ReactNode;
  if (tooSmall) {
    content = <MinSizeGuard columns={columns} rows={rows} />;
  } else if (consoleOpen) {
    content = (
      <DevConsole
        dispatch={dispatch}
        output={consoleOutput}
        setOutput={setConsoleOutput}
        state={state}
      />
    );
  } else if (!started) {
    content = (
      <Box flexDirection="column">
        <TitleScreen hasSave={hasSave} modeCursor={modeCursor} />
        {devConsoleEnabled && (
          <Text dimColor>Dev console: press ` to switch.</Text>
        )}
      </Box>
    );
  } else if (gameOver) {
    content = <GameOverScreen />;
  } else {
    switch (state.scene) {
      case "village":
        content = <VillageScreen dispatch={dispatch} state={state} />;
        break;
      case "overworld":
        content = <OverworldScreen dispatch={dispatch} state={state} />;
        break;
      case "dungeon":
        content = <DungeonScreen dispatch={dispatch} state={state} />;
        break;
      case "battle":
        content = <BattleScreen dispatch={dispatch} state={state} />;
        break;
    }
  }

  // Root is pinned to the live terminal size so the whole tree is bounded and
  // any rare local overflow is clipped rather than scrambling the screen.
  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      {content}
    </Box>
  );
}

const savedGame = loadGame();
const hasSave = savedGame !== undefined;
const store = new GameStore(savedGame ?? newGame(Date.now()));

render(
  <TerminalLayoutProvider>
    <App
      devConsoleEnabled={process.argv.includes("--dev")}
      hasSave={hasSave}
      store={store}
    />
  </TerminalLayoutProvider>,
  { alternateScreen: true },
);

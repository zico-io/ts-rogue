import { Box, render, Text, useApp, useInput } from "ink";
import { type ReactNode, useState } from "react";
import { GameStore, newGame } from "./engine/state/store";
import type { Scene } from "./engine/state/types";
import { loadGame } from "./persistence/save";
import {
  MinSizeGuard,
  TerminalLayoutProvider,
  useTerminalLayout,
} from "./ui/components/MinSizeGuard";
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
  seed,
}: {
  store: GameStore;
  hasSave: boolean;
  devConsoleEnabled: boolean;
  seed: number;
}) {
  const { exit } = useApp();
  const { columns, rows, tooSmall } = useTerminalLayout();
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
      // boot with no save needs a new run seeded here. Reuse the boot seed so
      // `--seed` stays deterministic across the "press any key" transition.
      if (!hasSave) {
        store.dispatch({ type: "NewGame", seed });
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
        <TitleScreen hasSave={hasSave} />
        {devConsoleEnabled && (
          <Text dimColor>Dev console: press ` to switch.</Text>
        )}
      </Box>
    );
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

// Dev/headless boot flags. `--fresh` ignores any save so a session always
// starts from a known state; `--seed=<n>` fixes the run seed instead of the
// clock, so the tmux play harness can reproduce a session deterministically.
const seedArg = process.argv.find((arg) => arg.startsWith("--seed="));
const parsedSeed = seedArg
  ? Number(seedArg.slice("--seed=".length))
  : Number.NaN;
const bootSeed = Number.isFinite(parsedSeed) ? parsedSeed : Date.now();
const fresh = process.argv.includes("--fresh");

const savedGame = fresh ? undefined : loadGame();
const hasSave = savedGame !== undefined;
const store = new GameStore(savedGame ?? newGame(bootSeed));

render(
  <TerminalLayoutProvider>
    <App
      devConsoleEnabled={process.argv.includes("--dev")}
      hasSave={hasSave}
      seed={bootSeed}
      store={store}
    />
  </TerminalLayoutProvider>,
  { alternateScreen: true },
);

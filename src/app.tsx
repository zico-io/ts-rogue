import { Box, render, Text, useApp, useInput } from "ink";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { CLASSES } from "./data/classes";
import { attempt } from "./engine/state/incidents";
import { GameStore, newGame } from "./engine/state/store";
import type { Scene } from "./engine/state/types";
import {
  FailureBoundary,
  type IncidentDisplay,
  IncidentPipeline,
} from "./lib/incidents";
import { clearSave, loadGame } from "./persistence/save";
import {
  MinSizeGuard,
  TerminalLayoutProvider,
  useTerminalLayout,
} from "./ui/components/MinSizeGuard";
import { useGameState } from "./ui/hooks/useGameState";
import { BattleScreen } from "./ui/screens/BattleScreen";
import { CrashScreen } from "./ui/screens/CrashScreen";
import { DevConsole } from "./ui/screens/DevConsole";
import { DungeonScreen } from "./ui/screens/DungeonScreen";
import { GameOverScreen } from "./ui/screens/GameOverScreen";
import { OverworldScreen } from "./ui/screens/OverworldScreen";
import { TitleScreen } from "./ui/screens/TitleScreen";
import { VillageScreen } from "./ui/screens/VillageScreen";
import { theme } from "./ui/theme";
import { initTiles } from "./ui/tiles/kitty";

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
  pipeline,
  failures,
}: {
  store: GameStore;
  hasSave: boolean;
  devConsoleEnabled: boolean;
  seed: number;
  pipeline: IncidentPipeline;
  failures: FailureBoundary;
}) {
  const { exit } = useApp();
  const { columns, rows, tooSmall } = useTerminalLayout();
  const [started, setStarted] = useState(false);
  const [titlePhase, setTitlePhase] = useState<"class" | "mode">("class");
  const [classCursor, setClassCursor] = useState(0);
  const [modeCursor, setModeCursor] = useState(0);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [fatal, setFatal] = useState<IncidentDisplay | undefined>(() =>
    pipeline.getFatal(),
  );
  const state = useGameState(store);
  const gameOver = state.flags?.gameOver ?? false;

  useEffect(() => pipeline.subscribe(setFatal), [pipeline]);

  useInput((input) => {
    if (!fatal && devConsoleEnabled && input === "`") {
      setConsoleOpen((open) => !open);
    }
  });

  // Title screen phase: on a fresh boot (no save) the player first picks a
  // class from the CLASSES table, then a mode (Normal/Permadeath), and Enter
  // starts the run; with an existing save any key continues (Phase 6, ROG-12
  // permadeath choice; ROG-17 class choice).
  useInput(
    (input, key) => {
      if (devConsoleEnabled && input === "`") return;
      if (isQuit(input, key)) {
        exit();
        return;
      }
      // A loaded save is already the store's initial state; press any key to
      // continue it. A fresh boot shows mode selection and seeds the new run
      // with the boot seed so `--seed` stays deterministic across the
      // transition (ROG-16 play harness).
      if (hasSave) {
        setStarted(true);
        return;
      }
      if (titlePhase === "class") {
        if (key.upArrow) {
          setClassCursor((c) => (c + CLASSES.length - 1) % CLASSES.length);
        } else if (key.downArrow) {
          setClassCursor((c) => (c + 1) % CLASSES.length);
        } else if (key.return) {
          setTitlePhase("mode");
        }
        return;
      }
      // titlePhase === "mode"
      if (key.escape) {
        setTitlePhase("class");
        return;
      }
      if (key.upArrow) {
        setModeCursor((c) => (c === 0 ? 1 : 0));
      } else if (key.downArrow) {
        setModeCursor((c) => (c === 0 ? 1 : 0));
      } else if (key.return) {
        store.dispatch({
          type: "NewGame",
          seed,
          classId: CLASSES[classCursor].id,
          permadeath: modeCursor === 1,
        });
        setStarted(true);
      }
    },
    { isActive: !fatal && !started && !consoleOpen },
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
    { isActive: !fatal && started && !consoleOpen && !gameOver },
  );

  // Game-over phase: Enter starts a new run (same class and permadeath mode),
  // q quits. The class is reused from the fallen hero so a run restarts in the
  // same class the player chose (ROG-17).
  useInput(
    (input, key) => {
      if (isQuit(input, key)) {
        exit();
        return;
      }
      if (key.return) {
        const permadeath = state.flags?.permadeath ?? false;
        const classId = state.party[0].classId;
        store.dispatch({
          type: "NewGame",
          seed: Date.now(),
          permadeath,
          classId,
        });
      }
    },
    { isActive: !fatal && started && !consoleOpen && gameOver },
  );

  // Clear the persisted save once the game is over so the next boot starts a
  // fresh run. I/O lives in the persistence layer, not the engine.
  useEffect(() => {
    if (gameOver) failures.run("clear", false, clearSave);
  }, [failures, gameOver]);

  const dispatch = (event: Parameters<GameStore["dispatch"]>[0]) =>
    store.dispatch(event);

  let content: ReactNode;
  if (fatal) {
    content = <CrashScreen display={fatal} />;
  } else if (tooSmall) {
    content = <MinSizeGuard columns={columns} rows={rows} />;
  } else if (consoleOpen) {
    content = (
      <DevConsole
        dispatch={dispatch}
        crash={(message) => failures.report("manual", new Error(message), true)}
        journal={store.getDebugJournal()}
        output={consoleOutput}
        pipeline={pipeline}
        setOutput={setConsoleOutput}
        state={state}
      />
    );
  } else if (!started) {
    content = (
      <Box flexDirection="column">
        <TitleScreen
          hasSave={hasSave}
          titlePhase={titlePhase}
          classCursor={classCursor}
          modeCursor={modeCursor}
        />
        {devConsoleEnabled && (
          <Text color={theme.textMuted}>Dev console: press ` to switch.</Text>
        )}
      </Box>
    );
  } else if (gameOver) {
    content = <GameOverScreen />;
  } else {
    switch (state.scene) {
      case "village":
        content = (
          <VillageScreen
            dispatch={dispatch}
            failures={failures}
            state={state}
          />
        );
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

class GameErrorBoundary extends Component<
  {
    children: ReactNode;
    failures: FailureBoundary;
    pipeline: IncidentPipeline;
  },
  { display?: IncidentDisplay }
> {
  state: { display?: IncidentDisplay } = {};
  private unsubscribe?: () => void;

  componentDidMount(): void {
    this.unsubscribe = this.props.pipeline.subscribe((display) =>
      this.setState({ display }),
    );
  }

  componentWillUnmount(): void {
    this.unsubscribe?.();
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.failures.report("render", error, true);
    this.setState({ display: this.props.pipeline.getFatal() });
  }

  render(): ReactNode {
    return this.state.display ? (
      <CrashScreen display={this.state.display} />
    ) : (
      this.props.children
    );
  }
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
const devConsoleEnabled = process.argv.includes("--dev");
const pipeline = new IncidentPipeline(devConsoleEnabled);
const loaded = attempt(() => {
  const savedGame = fresh ? undefined : loadGame();
  return {
    hasSave: savedGame !== undefined,
    store: new GameStore(savedGame ?? newGame(bootSeed)),
  };
});
const store = loaded.ok ? loaded.value.store : new GameStore(newGame(bootSeed));
const hasSave = loaded.ok ? loaded.value.hasSave : false;
const failures = new FailureBoundary(store);
store.subscribeIncidents((incident) => pipeline.capture(incident));
if (!loaded.ok) failures.report("load", loaded.error, true);
process.on("unhandledRejection", (error) =>
  failures.report("unhandled-rejection", error, true),
);
process.on("uncaughtException", (error) =>
  failures.report("uncaught-exception", error, true),
);

const rendered = failures.run("boot", true, () =>
  render(
    <TerminalLayoutProvider>
      <GameErrorBoundary failures={failures} pipeline={pipeline}>
        <App
          devConsoleEnabled={devConsoleEnabled}
          failures={failures}
          hasSave={hasSave}
          pipeline={pipeline}
          seed={bootSeed}
          store={store}
        />
      </GameErrorBoundary>
    </TerminalLayoutProvider>,
    { alternateScreen: true },
  ),
);
// Kitty graphics storage is per-screen (Ghostty clears the alternate screen's
// images on entry), so the tileset must be transmitted after Ink switches to
// the alternate screen - i.e. after render(), not before.
initTiles();
if (!rendered.ok) {
  const display = pipeline.getFatal();
  if (display) render(<CrashScreen display={display} />);
}

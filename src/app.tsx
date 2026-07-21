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
  DEFAULT_SETTINGS,
  type GameSettings,
  loadSettings,
  saveSettings,
} from "./persistence/settings";
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
import { SettingsScreen } from "./ui/screens/SettingsScreen";
import {
  MAX_NAME_LENGTH,
  mainMenuOptions,
  TitleScreen,
  type TitleView,
} from "./ui/screens/TitleScreen";
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
  hasSave: initialHasSave,
  initialSettings,
  devConsoleEnabled,
  seed,
  pipeline,
  failures,
}: {
  store: GameStore;
  hasSave: boolean;
  initialSettings: GameSettings;
  devConsoleEnabled: boolean;
  seed: number;
  pipeline: IncidentPipeline;
  failures: FailureBoundary;
}) {
  const { exit } = useApp();
  const { columns, rows, tooSmall } = useTerminalLayout();
  const [started, setStarted] = useState(false);
  const [hasSave, setHasSave] = useState(initialHasSave);
  const [settings, setSettings] = useState(initialSettings);
  const [titleView, setTitleView] = useState<TitleView>("menu");
  const [menuCursor, setMenuCursor] = useState(0);
  const [classCursor, setClassCursor] = useState(0);
  const [modeCursor, setModeCursor] = useState(0);
  const [nameInput, setNameInput] = useState(initialSettings.defaultHeroName);
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

  // Title flow: the landing view is a main menu (New Game / Continue / Settings
  // / Quit). New Game walks class -> mode -> name, then Enter starts the run,
  // seeded with the custom seed setting or the boot seed so `--seed` stays
  // deterministic (ROG-16 play harness). Settings is a separate component that
  // owns its own input, so this handler is inactive there. (Phase 6, ROG-12
  // permadeath; ROG-17 class; title overhaul.)
  useInput(
    (input, key) => {
      if (devConsoleEnabled && input === "`") return;

      // Name entry accepts printable chars, so bare `q` must type - only
      // Ctrl-C quits here; Esc backs out to mode selection.
      if (titleView === "name") {
        if (key.ctrl && input === "c") {
          exit();
        } else if (key.escape) {
          setTitleView("mode");
        } else if (key.return) {
          const name = nameInput.trim();
          if (!name) return;
          store.dispatch({
            type: "NewGame",
            seed: settings.customSeed ?? seed,
            classId: CLASSES[classCursor].id,
            permadeath: modeCursor === 1,
            name,
          });
          setStarted(true);
        } else if (key.backspace || key.delete) {
          setNameInput((value) => value.slice(0, -1));
        } else if (
          input &&
          !key.ctrl &&
          !key.meta &&
          nameInput.length < MAX_NAME_LENGTH
        ) {
          setNameInput((value) => value + input);
        }
        return;
      }

      if (isQuit(input, key)) {
        exit();
        return;
      }

      if (titleView === "menu") {
        const options = mainMenuOptions(hasSave);
        if (key.upArrow) {
          setMenuCursor((c) => (c + options.length - 1) % options.length);
        } else if (key.downArrow) {
          setMenuCursor((c) => (c + 1) % options.length);
        } else if (key.return) {
          const option = options[menuCursor];
          if (option.id === "new") {
            setClassCursor(0);
            setTitleView("class");
          } else if (option.id === "continue") {
            setStarted(true);
          } else if (option.id === "settings") {
            setTitleView("settings");
          } else {
            exit();
          }
        }
        return;
      }

      if (titleView === "class") {
        if (key.escape) {
          setTitleView("menu");
        } else if (key.upArrow) {
          setClassCursor((c) => (c + CLASSES.length - 1) % CLASSES.length);
        } else if (key.downArrow) {
          setClassCursor((c) => (c + 1) % CLASSES.length);
        } else if (key.return) {
          setModeCursor(settings.defaultPermadeath ? 1 : 0);
          setTitleView("mode");
        }
        return;
      }

      // titleView === "mode"
      if (key.escape) {
        setTitleView("class");
      } else if (key.upArrow || key.downArrow) {
        setModeCursor((c) => (c === 0 ? 1 : 0));
      } else if (key.return) {
        setNameInput(settings.defaultHeroName);
        setTitleView("name");
      }
    },
    {
      isActive: !fatal && !started && !consoleOpen && titleView !== "settings",
    },
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
        const name = state.party[0].name;
        store.dispatch({
          type: "NewGame",
          seed: Date.now(),
          permadeath,
          classId,
          name,
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

  // Settings edits persist to disk immediately; local state is the source of
  // truth for the New Game defaults. Deleting the save flips `hasSave` so the
  // menu's Continue entry disappears. I/O is wrapped so a write failure surfaces
  // through the incident pipeline instead of crashing the title screen.
  const updateSettings = (next: GameSettings) => {
    setSettings(next);
    failures.run("save", false, () => saveSettings(next));
  };
  const deleteSave = () => {
    failures.run("clear", false, clearSave);
    setHasSave(false);
    setMenuCursor(0);
  };

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
      <Box
        flexDirection="column"
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
      >
        {titleView === "settings" ? (
          <SettingsScreen
            settings={settings}
            hasSave={hasSave}
            onUpdate={updateSettings}
            onDeleteSave={deleteSave}
            onClose={() => setTitleView("menu")}
          />
        ) : (
          <TitleScreen
            titleView={titleView}
            hasSave={hasSave}
            menuCursor={menuCursor}
            classCursor={classCursor}
            modeCursor={modeCursor}
            nameInput={nameInput}
          />
        )}
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
const settingsLoad = attempt(() => loadSettings());
const initialSettings = settingsLoad.ok ? settingsLoad.value : DEFAULT_SETTINGS;
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
          initialSettings={initialSettings}
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

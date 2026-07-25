import { Box, render, Text, useApp, useInput } from "ink";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { attempt } from "./engine/state/incidents";
import { GameStore, newGame } from "./engine/state/store";
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
import { normalizeInkKey } from "./ui/hooks/normalizeInkKey";
import { useGameState } from "./ui/hooks/useGameState";
import { resolveGlobalIntent } from "./ui/scene/globalInput";
import { BattleScreen } from "./ui/screens/BattleScreen";
import { CrashScreen } from "./ui/screens/CrashScreen";
import { DevConsole } from "./ui/screens/DevConsole";
import { DungeonScreen } from "./ui/screens/DungeonScreen";
import { GameOverScreen } from "./ui/screens/GameOverScreen";
import { InventoryScreen } from "./ui/screens/InventoryScreen";
import { LootTriageScreen } from "./ui/screens/LootTriageScreen";
import { OverworldScreen } from "./ui/screens/OverworldScreen";
import { SettingsScreen } from "./ui/screens/SettingsScreen";
import { TitleScreen } from "./ui/screens/TitleScreen";
import {
  reduceTitleUi,
  resolveTitleIntent,
  type TitleUiState,
} from "./ui/screens/title/interaction";
import { VillageScreen } from "./ui/screens/VillageScreen";
import { ZoomScreen } from "./ui/screens/ZoomScreen";
import { theme } from "./ui/theme";

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
  const [titleUi, setTitleUi] = useState<TitleUiState>({
    view: "menu",
    menuCursor: 0,
    classCursor: 0,
    modeCursor: 0,
    nameInput: initialSettings.defaultHeroName,
  });
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [fatal, setFatal] = useState<IncidentDisplay | undefined>(() =>
    pipeline.getFatal(),
  );
  const state = useGameState(store);
  const gameOver = state.flags?.gameOver ?? false;

  useEffect(() => pipeline.subscribe(setFatal), [pipeline]);

  // Global dev-console toggle (ROG-45's `globalInput`): active whenever the
  // dev console is enabled at all, regardless of which scene/screen owns
  // focus, so it works from the title screen too.
  useInput((input, key) => {
    if (fatal || !devConsoleEnabled) return;
    const keyName = normalizeInkKey(input, key);
    if (keyName && resolveGlobalIntent(keyName)?.kind === "toggleConsole") {
      setConsoleOpen((open) => !open);
    }
  });

  // Title flow: the landing view is a main menu (New Game / Continue / Settings
  // / Quit). New Game walks class -> mode -> name, then Enter starts the run,
  // seeded with the custom seed setting or the boot seed so `--seed` stays
  // deterministic (ROG-16 play harness). Settings is a separate component that
  // owns its own input, so this handler is inactive there. (Phase 6, ROG-12
  // permadeath; ROG-17 class; title overhaul.) The actual view/cursor
  // transitions and side effects live in the pure `reduceTitleUi` (ROG-56);
  // this handler only normalizes Ink's input and applies the result.
  useInput(
    (input, key) => {
      if (devConsoleEnabled && input === "`") return;

      const keyName = normalizeInkKey(input, key);
      if (!keyName) return;
      const intent = resolveTitleIntent(titleUi.view, keyName);
      if (!intent) return;

      const result = reduceTitleUi(titleUi, intent, {
        hasSave,
        defaultPermadeath: settings.defaultPermadeath,
        defaultHeroName: settings.defaultHeroName,
      });
      let nextState = result.state;

      switch (result.effect?.type) {
        case "startNewGame":
          store.dispatch({
            type: "NewGame",
            seed: settings.customSeed ?? seed,
            classId: result.effect.classId,
            permadeath: result.effect.permadeath,
            name: result.effect.name,
          });
          setStarted(true);
          break;
        case "continueGame":
          setStarted(true);
          break;
        case "openSettings":
          nextState = { ...nextState, view: "settings" };
          break;
        case "quit":
          exit();
          break;
        default:
          break;
      }

      setTitleUi(nextState);
    },
    {
      isActive:
        !fatal && !started && !consoleOpen && titleUi.view !== "settings",
    },
  );

  // In-game scene switching (blocked while the game is over). Digit hotkeys
  // and quit both come from the shared `globalInput` keymap (ROG-45), so the
  // browser keyboard manager resolves the exact same bindings.
  useInput(
    (input, key) => {
      const keyName = normalizeInkKey(input, key);
      if (!keyName) return;
      const intent = resolveGlobalIntent(keyName);
      if (!intent) return;
      if (intent.kind === "quit") {
        exit();
        return;
      }
      if (intent.kind === "changeScene") {
        store.dispatch({ type: "ChangeScene", scene: intent.scene });
      }
      if (intent.kind === "openZoom") {
        if (state.scene === "village" || state.scene === "overworld") {
          setZoomOpen(true);
        }
      }
      if (intent.kind === "openInventory") {
        if (state.scene !== "battle") {
          setInventoryOpen(true);
        }
      }
    },
    {
      isActive:
        !fatal &&
        started &&
        !consoleOpen &&
        !gameOver &&
        !zoomOpen &&
        !inventoryOpen &&
        state.pendingLootTriage === null,
    },
  );

  // Game-over phase: Enter starts a new run (same class and permadeath mode),
  // q quits. The class is reused from the fallen hero so a run restarts in the
  // same class the player chose (ROG-17).
  useInput(
    (input, key) => {
      const keyName = normalizeInkKey(input, key);
      if (keyName && resolveGlobalIntent(keyName)?.kind === "quit") {
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
    setTitleUi((ui) => ({ ...ui, menuCursor: 0 }));
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
  } else if (started && state.pendingLootTriage) {
    content = <LootTriageScreen dispatch={dispatch} state={state} />;
  } else if (zoomOpen) {
    content = (
      <ZoomScreen
        dispatch={dispatch}
        onClose={() => setZoomOpen(false)}
        state={state}
      />
    );
  } else if (inventoryOpen) {
    content = (
      <InventoryScreen
        dispatch={dispatch}
        onClose={() => setInventoryOpen(false)}
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
        {titleUi.view === "settings" ? (
          <SettingsScreen
            settings={settings}
            hasSave={hasSave}
            onUpdate={updateSettings}
            onDeleteSave={deleteSave}
            onClose={() => setTitleUi((ui) => ({ ...ui, view: "menu" }))}
          />
        ) : (
          <TitleScreen
            titleView={titleUi.view}
            hasSave={hasSave}
            menuCursor={titleUi.menuCursor}
            classCursor={titleUi.classCursor}
            modeCursor={titleUi.modeCursor}
            nameInput={titleUi.nameInput}
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
if (!rendered.ok) {
  const display = pipeline.getFatal();
  if (display) render(<CrashScreen display={display} />);
}

import { Application, Container, Sprite, Text } from "pixi.js";
import { CLASSES } from "../data/classes";
import { SHOP_ITEMS, sellPriceFor } from "../data/shops";
import { atkFrom, defFrom, spdFrom } from "../engine/combat/resolution";
import { recruitClassName, recruitCost } from "../engine/entities/recruits";
import { compareItem, equipTargetSlot } from "../engine/loot/equipment";
import {
  describeItem,
  itemSellPrice,
  itemStatLine,
} from "../engine/loot/items";
import type { GameIncident } from "../engine/state/incidents";
import { GameStore, INN_COST_PER_MEMBER, newGame } from "../engine/state/store";
import type { GameState, Scene } from "../engine/state/types";
import { generateOverworldMap } from "../engine/world/overworld";
import type { OverworldMap } from "../engine/world/types";
import {
  clearSave as clearBrowserSave,
  loadGame as loadBrowserGame,
} from "../persistence/browserSave";
import { resolveGlobalIntent } from "../ui/scene/globalInput";
import { BANNER } from "../ui/screens/gameOverBanner";
import { LOGO, mainMenuOptions } from "../ui/screens/title/display";
import {
  reduceTitleUi,
  resolveTitleIntent,
  type TitleUiState,
} from "../ui/screens/title/interaction";
import {
  buildPackEntries,
  EQUIP_SLOTS,
  OPTIONS,
  type OverviewUiState,
  type StoreUiState,
  type TavernUiState,
} from "../ui/screens/village/interaction";
import { theme, toPixiColor } from "../ui/theme";
import { loadAtlas } from "./atlas";
import { parseBootFlags } from "./boot";
import { BrowserDevConsole } from "./devConsole";
import { BrowserKeyboardManager } from "./input/keyboard";
import { normalizeBrowserKey } from "./input/normalizeBrowserKey";
import { BattleSceneView } from "./render/battleView";
import { CrashOverlayView } from "./render/crashOverlay";
import { DevConsoleOverlayView } from "./render/devConsoleOverlay";
import { DungeonSceneView } from "./render/dungeonView";
import { OverworldSceneView } from "./render/overworldView";
import { createPixiBattleDrawFactory } from "./render/pixiBattleDrawFactory";
import { createPixiDrawFactory } from "./render/pixiDrawFactory";
import { createPixiDungeonDrawFactory } from "./render/pixiDungeonDrawFactory";
import { createPixiOverworldDrawFactory } from "./render/pixiOverworldDrawFactory";
import { type ContentRect, SceneChromeView } from "./render/sceneView";
import { SCENE_ORDER, SceneSwitcher, type SceneView } from "./scenes";

const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;
/** Native atlas tiles are 12x12; scale up so pixel art reads clearly on a modern display. */
const PREVIEW_SCALE = 6;
/** No settings persistence in the browser yet, so New Game always defaults to this name. */
const DEFAULT_HERO_NAME = "Hero";

const appMount = document.getElementById("app");
const overlayEl = document.getElementById("min-size-overlay");
if (!appMount || !overlayEl) {
  throw new Error("index.html is missing #app or #min-size-overlay");
}
// Rebind as non-null typed constants; TS does not retain the null-check
// narrowing of `appMount`/`overlayEl` across the closures declared below.
const mount: HTMLElement = appMount;
const overlay: HTMLElement = overlayEl;

/** Replaces the canvas mount with a minimal plain-text crash overlay. */
function showCrash(context: string, error: unknown): void {
  mount.innerHTML = "";
  const message = error instanceof Error ? error.message : String(error);
  const box = document.createElement("div");
  box.style.color = theme.danger;
  box.style.fontFamily = "monospace";
  box.style.padding = "1em";
  box.style.whiteSpace = "pre-wrap";
  box.textContent = `ts-rogue crashed (${context})\n${message}`;
  mount.appendChild(box);
}

const flags = parseBootFlags(window.location.search);

/**
 * Loads the single IndexedDB save slot (ROG-46), mirroring `app.tsx`'s
 * `fresh ? undefined : loadGame()` - `?fresh` bypasses the load entirely so
 * a session always starts from a known state. There is no `store`/incident
 * pipeline yet at this point in boot, so a corrupt/unreadable save is
 * logged and treated as "no save" rather than crashing the whole app; only
 * `GameStore`'s own constructor failing below still shows the plain-text
 * `showCrash` overlay.
 */
async function loadInitialSave(): Promise<GameState | undefined> {
  if (flags.fresh) return undefined;
  try {
    return await loadBrowserGame();
  } catch (error) {
    console.error("ts-rogue: failed to load browser save", error);
    return undefined;
  }
}

const savedGame = await loadInitialSave();
/** Drives the title menu's Continue entry; flipped by a successful Church save and by the auto-clear on game over below. */
let hasSave = savedGame !== undefined;

let store: GameStore;
try {
  store = new GameStore(savedGame ?? newGame(flags.seed));
} catch (error) {
  showCrash("boot", error);
  throw error;
}

/**
 * The current fatal incident, if any (ROG-48). Set from `store`'s own
 * `subscribeIncidents` (reducer/invariant failures the store already
 * catches internally) below, and by every `store.reportFailure` call this
 * module makes directly for failures the store can't see itself (atlas/
 * view setup, `window.onerror`, `unhandledrejection`). `renderCurrent`
 * checks it first and, like the terminal's `if (fatal) return <CrashScreen
 * />`, skips every other render while it's set - the crash overlay itself
 * is shown synchronously from the `subscribeIncidents` callback, not from
 * `renderCurrent`, so it appears immediately even if rendering itself is
 * what's broken.
 */
let fatalIncident: GameIncident | undefined;
const crashOverlay = new CrashOverlayView(document.body, () =>
  window.location.reload(),
);
store.subscribeIncidents((incident) => {
  if (!incident.fatal) return;
  fatalIncident = incident;
  crashOverlay.show(incident);
});

// Catches renderer failures `store.dispatch`/the try/catches below can't see
// themselves - e.g. a throw inside a Pixi ticker callback or a DOM event
// handler - and routes them through the same incident pipeline instead of a
// blank tab. Wired here (store exists, nothing else has run yet) so every
// later failure, including during Pixi/atlas setup, is covered.
window.addEventListener("error", (event) => {
  store.reportFailure("uncaught-exception", event.error ?? event.message, true);
});
window.addEventListener("unhandledrejection", (event) => {
  store.reportFailure("unhandled-rejection", event.reason, true);
});

const app = new Application();
await app.init({
  resizeTo: mount,
  backgroundColor: "#000000",
  antialias: true,
});
mount.appendChild(app.canvas);

/**
 * Which of the Ink terminal renderer's three top-level phases (see
 * `app.tsx`) the browser is showing. `GameStore.state.scene` only decides
 * which *playing* scene is active; title and game-over sit outside that,
 * exactly as they do in `app.tsx` (`started`/`flags.gameOver`).
 */
type Phase = "title" | "playing";
let phase: Phase = "title";

/** The title flow's own local UI state; mirrors the one `app.tsx` owns in `useState`. */
let titleUi: TitleUiState = {
  view: "menu",
  menuCursor: 0,
  classCursor: 0,
  modeCursor: 0,
  nameInput: "",
};

/** Resets the title flow back to its landing menu (boot, and after quitting from play). */
function resetTitleUi(): void {
  titleUi = {
    view: "menu",
    menuCursor: 0,
    classCursor: 0,
    modeCursor: 0,
    nameInput: "",
  };
}

/** Returns to the title screen. Bound as `BrowserKeyboardManager`'s `onQuit`. */
function quitToTitle(): void {
  phase = "title";
  resetTitleUi();
}

/** Title-cases a scene id for the chrome panel's title, e.g. "village" -> "Village". */
function sceneTitle(scene: Scene): string {
  return scene.charAt(0).toUpperCase() + scene.slice(1);
}

/**
 * One scene's container plus the label-driven view `SceneSwitcher` uses, and
 * the ROG-47 HUD chrome drawn around its content. `chrome` is the Pixi
 * interpreter for the shared `buildChrome` tree (`src/ui/scene/chrome.ts`);
 * `contentContainer` is the scene's content region, repositioned to the
 * chrome's computed content rect on every render - the Pixi analog of
 * `useScreenContent` sizing a scene's viewport from the frame chrome.
 */
interface SceneEntry {
  container: Container;
  contentContainer: Container;
  chrome: SceneChromeView;
  view: SceneView;
  /** The generic placeholder label `SceneSwitcher` writes `describeState` into. */
  label: Text;
}

/** Builds one scene's container, chrome view, and the label-driven view `SceneSwitcher` uses. */
function buildSceneEntry(scene: Scene): SceneEntry {
  const container = new Container();
  container.visible = false;
  app.stage.addChild(container);

  const chromeContainer = new Container();
  container.addChild(chromeContainer);
  const chrome = new SceneChromeView(createPixiDrawFactory(chromeContainer));

  const contentContainer = new Container();
  container.addChild(contentContainer);

  const label = new Text({
    text: scene,
    style: {
      fill: toPixiColor(theme.text),
      fontSize: 20,
      fontFamily: "monospace",
    },
  });
  label.position.set(24, 24);
  contentContainer.addChild(label);

  return {
    container,
    contentContainer,
    chrome,
    label,
    view: {
      setVisible(visible: boolean) {
        container.visible = visible;
      },
      setLabel(text: string) {
        label.text = text;
      },
    },
  };
}

const entries = Object.fromEntries(
  SCENE_ORDER.map((scene) => [scene, buildSceneEntry(scene)]),
) as Record<Scene, SceneEntry>;
const views = Object.fromEntries(
  SCENE_ORDER.map((scene) => [scene, entries[scene].view]),
) as Record<Scene, SceneView>;
const switcher = new SceneSwitcher(views);

// Real village content (below) replaces the village scene's generic
// placeholder label; hide it so it doesn't draw underneath that content.
// The other three scenes keep their placeholder (ROG-49/50/51 own real
// rendering for those).
entries.village.label.visible = false;

// Real overworld content (tilemap/minimap/meter, below) replaces its
// generic placeholder label the same way village's does.
entries.overworld.label.visible = false;

// Real battle content (sprites/menus, below) replaces its generic
// placeholder label the same way village's/overworld's does.
entries.battle.label.visible = false;

// Real dungeon content (raycast scene, below) replaces its generic
// placeholder label the same way the other three scenes' do.
entries.dungeon.label.visible = false;

/** Each scene's content-region rect from the most recent `renderChrome()`, in pixels. */
const contentRects = Object.fromEntries(
  SCENE_ORDER.map((scene) => [
    scene,
    { x: 0, y: 0, width: 0, height: 0 } satisfies ContentRect,
  ]),
) as Record<Scene, ContentRect>;

/**
 * Rebuilds every scene's HUD chrome (frame, party bar, message log) at the
 * canvas's current size and repositions each scene's content container to
 * the chrome's computed content rect, so a resize or a dispatch that
 * changes HP/MP/log always redraws the frame around up-to-date content.
 * Stashes each scene's content rect in `contentRects` so per-scene content
 * renderers (e.g. `renderOverworldContent`) know how much pixel space they
 * have without recomputing the chrome themselves.
 */
function renderChrome(state: GameState): void {
  const size = { width: app.screen.width, height: app.screen.height };
  for (const scene of SCENE_ORDER) {
    const entry = entries[scene];
    const contentRect = entry.chrome.render(state, size, {
      title: sceneTitle(scene),
    });
    entry.contentContainer.position.set(contentRect.x, contentRect.y);
    contentRects[scene] = contentRect;
  }
}

/**
 * Atlas smoke test (ROG-44): draws one tile sprite and one monster sprite
 * into the village scene's content region (the scene a fresh boot lands
 * on), proving the atlas built by `scripts/build-atlas.ts` loads through
 * Pixi's `Assets` and renders inside the ROG-47 chrome. Real per-scene
 * sprite content lands in ROG-49 through ROG-52.
 */
async function showAtlasPreview(): Promise<void> {
  const sheet = await loadAtlas();
  const villageContent = entries.village.contentContainer;
  const previewLabel = new Text({
    text: "atlas preview: grass tile + slime sprite",
    style: {
      fill: toPixiColor(theme.textMuted),
      fontSize: 12,
      fontFamily: "monospace",
    },
  });
  previewLabel.position.set(24, 72);
  villageContent.addChild(previewLabel);

  const grass = new Sprite(sheet.textures.grass);
  grass.texture.source.scaleMode = "nearest";
  grass.scale.set(PREVIEW_SCALE);
  grass.position.set(24, 96);
  villageContent.addChild(grass);

  const slime = new Sprite(sheet.textures.slime);
  slime.texture.source.scaleMode = "nearest";
  slime.scale.set(PREVIEW_SCALE);
  slime.position.set(24 + 12 * PREVIEW_SCALE + 16, 96);
  villageContent.addChild(slime);
}
try {
  await showAtlasPreview();
} catch (error) {
  store.reportFailure("atlas", error, true);
}

/** Pixel size of one main-viewport overworld tile; the minimap draws smaller than this (see `overworldView.ts`). */
const OVERWORLD_TILE_PX = 24;

let overworldView: OverworldSceneView | undefined;

/** Loads the atlas (safe to call again; see `loadAtlas`'s doc comment) and builds the overworld's Pixi draw factory/view. */
async function setupOverworldView(): Promise<void> {
  const sheet = await loadAtlas();
  const factory = createPixiOverworldDrawFactory(
    entries.overworld.contentContainer,
    sheet,
  );
  overworldView = new OverworldSceneView(factory);
}
try {
  await setupOverworldView();
} catch (error) {
  store.reportFailure("overworld-view", error, true);
}

let battleView: BattleSceneView | undefined;

/** Loads the atlas (safe to call again; see `loadAtlas`'s doc comment) and builds the battle scene's Pixi draw factory/view. */
async function setupBattleView(): Promise<void> {
  const sheet = await loadAtlas();
  const factory = createPixiBattleDrawFactory(
    entries.battle.contentContainer,
    sheet,
  );
  battleView = new BattleSceneView(factory);
}
try {
  await setupBattleView();
} catch (error) {
  store.reportFailure("battle-view", error, true);
}
// Ages/removes floating damage numbers and reverts tint flashes every real
// animation frame (see `battleView.ts`'s module doc); a no-op before the
// view exists (while `setupBattleView` is still loading the atlas).
app.ticker.add((ticker) => battleView?.tick(ticker.deltaMS));

let dungeonView: DungeonSceneView | undefined;

/** Loads the atlas (safe to call again; see `loadAtlas`'s doc comment) and builds the dungeon scene's Pixi draw factory/view (ROG-50). */
async function setupDungeonView(): Promise<void> {
  const sheet = await loadAtlas();
  const factory = createPixiDungeonDrawFactory(
    entries.dungeon.contentContainer,
    sheet,
  );
  dungeonView = new DungeonSceneView(factory);
}
try {
  await setupDungeonView();
} catch (error) {
  store.reportFailure("dungeon-view", error, true);
}

let cachedOverworldMap: OverworldMap | undefined;
let cachedOverworldSeed: number | undefined;

/** `generateOverworldMap` is a pure function of `state.seed` (see `overworld.ts`); memoized so a per-render call stays cheap. */
function overworldMapFor(state: GameState): OverworldMap {
  if (cachedOverworldMap && cachedOverworldSeed === state.seed) {
    return cachedOverworldMap;
  }
  cachedOverworldMap = generateOverworldMap(state.seed);
  cachedOverworldSeed = state.seed;
  return cachedOverworldMap;
}

// ---------------------------------------------------------------------------
// Title, game-over, and village-content rendering
//
// These three views are all "menu plumbing" (ROG-52): none of them go
// through the ROG-47 chrome tree (`buildChrome`/`SceneChromeView`) - title
// and game-over aren't `GameStore` scenes at all, and the village's building
// sub-views are content *inside* the village scene's existing chrome, not a
// new chrome of their own. Each one destroys and recreates its Text children
// on every render instead of a keyed diff, matching this issue's framing:
// small, infrequently-updated menus, not a hot path worth a new abstraction.
// ---------------------------------------------------------------------------

/** One line of plain Pixi text; `color` defaults to `theme.text`. */
interface Line {
  text: string;
  color?: number;
}

/** Destroys every child of `container`, so repeated renders don't leak Text/Graphics objects. */
function clearContainer(container: Container): void {
  for (const child of container.removeChildren()) child.destroy();
}

/** Draws `lines` stacked vertically from `(x, y)`; returns the y position after the last line. */
function drawLines(
  container: Container,
  lines: readonly Line[],
  x: number,
  y: number,
  opts: { lineHeight?: number; fontSize?: number; bold?: boolean } = {},
): number {
  const lineHeight = opts.lineHeight ?? 18;
  let cursorY = y;
  for (const line of lines) {
    const text = new Text({
      text: line.text,
      style: {
        fill: line.color ?? toPixiColor(theme.text),
        fontSize: opts.fontSize ?? 14,
        fontFamily: "monospace",
        fontWeight: opts.bold ? "bold" : "normal",
      },
    });
    text.position.set(x, cursorY);
    container.addChild(text);
    cursorY += lineHeight;
  }
  return cursorY;
}

const titleContainer = new Container();
titleContainer.visible = false;
app.stage.addChild(titleContainer);

/** Draws the title menu: logo, then whichever of menu/class/mode/name is active. */
function renderTitle(): void {
  clearContainer(titleContainer);

  let y = drawLines(
    titleContainer,
    LOGO.map((text, index) => ({
      text,
      color: toPixiColor(theme.logoGradient[index]),
    })),
    24,
    24,
    { lineHeight: 20, fontSize: 16, bold: true },
  );
  y = drawLines(
    titleContainer,
    [
      {
        text: "A terminal dungeon crawler.",
        color: toPixiColor(theme.textMuted),
      },
    ],
    24,
    y + 6,
  );
  y += 12;

  const lines: Line[] = [];
  let hint: string;
  switch (titleUi.view) {
    case "class": {
      lines.push({ text: "Choose your class:" });
      for (const [index, cls] of CLASSES.entries()) {
        const selected = index === titleUi.classCursor;
        lines.push({
          text: `${selected ? "> " : "  "}${cls.name} - ${cls.description}`,
          color: selected ? toPixiColor(theme.accent) : undefined,
        });
      }
      hint = "Up/Down to choose, Enter to continue, Esc to go back.";
      break;
    }
    case "mode": {
      lines.push({ text: "Choose your mode:" });
      lines.push({
        text: `${titleUi.modeCursor === 0 ? "> " : "  "}Normal - revive at the village on defeat`,
        color: titleUi.modeCursor === 0 ? toPixiColor(theme.accent) : undefined,
      });
      lines.push({
        text: `${titleUi.modeCursor === 1 ? "> " : "  "}Permadeath - one life, one run`,
        color: titleUi.modeCursor === 1 ? toPixiColor(theme.accent) : undefined,
      });
      hint = "Up/Down to choose, Enter to continue, Esc to go back.";
      break;
    }
    case "name": {
      lines.push({ text: "Name your hero:" });
      lines.push({
        text: `> ${titleUi.nameInput}_`,
        color: toPixiColor(theme.accent),
      });
      hint = "Type a name, Enter to start, Esc to go back.";
      break;
    }
    default: {
      // "menu" (the browser has no SettingsScreen, so "settings" never shows).
      const options = mainMenuOptions(false);
      for (const [index, option] of options.entries()) {
        const selected = index === titleUi.menuCursor;
        lines.push({
          text: `${selected ? "> " : "  "}${option.label}`,
          color: selected ? toPixiColor(theme.accent) : undefined,
        });
      }
      hint = "Up/Down to choose, Enter to select.";
      break;
    }
  }
  y = drawLines(titleContainer, lines, 24, y);
  drawLines(
    titleContainer,
    [{ text: hint, color: toPixiColor(theme.textMuted) }],
    24,
    y + 8,
  );
}

/** Applies a title-phase key press: normalize, resolve/reduce, apply the effect. */
function handleTitleKeyDown(event: KeyboardEvent): void {
  const keyName = normalizeBrowserKey(event);
  if (!keyName) return;
  const intent = resolveTitleIntent(titleUi.view, keyName);
  if (!intent) return;

  const result = reduceTitleUi(titleUi, intent, {
    hasSave,
    defaultPermadeath: false,
    defaultHeroName: DEFAULT_HERO_NAME,
  });
  titleUi = result.state;

  switch (result.effect?.type) {
    case "startNewGame":
      store.dispatch({
        type: "NewGame",
        // Honor the boot `?seed` so a run started from the title is reproducible
        // (the play-web harness replays this flow); `flags.seed` already defaults
        // to a clock value when no `?seed` is given, so play stays random by default.
        seed: flags.seed,
        classId: result.effect.classId,
        permadeath: result.effect.permadeath,
        name: result.effect.name,
      });
      phase = "playing";
      break;
    case "continueGame":
      // `store` was already constructed from the loaded save at boot
      // (ROG-46), so there is nothing left to load here - just leave the
      // title flow the same way `app.tsx`'s `setStarted(true)` does.
      phase = "playing";
      break;
    case "openSettings":
      // No browser SettingsScreen. Stashed, matching `keyboard.ts`'s
      // existing stash pattern, until one exists.
      store.dispatch({
        type: "Log",
        message: "Settings aren't available in the browser yet",
      });
      break;
    case "quit":
      // No OS process to exit in the browser; stay on the title menu.
      store.dispatch({
        type: "Log",
        message: "Quit isn't available in the browser yet",
      });
      break;
    default:
      break;
  }
}

const gameOverContainer = new Container();
gameOverContainer.visible = false;
app.stage.addChild(gameOverContainer);

/** Draws the game-over view: banner, one-line summary, and the restart/quit hint. */
function renderGameOverView(): void {
  clearContainer(gameOverContainer);
  let y = drawLines(
    gameOverContainer,
    BANNER.map((text, index) => ({
      text,
      color: toPixiColor(theme.gameOverGradient[index]),
    })),
    24,
    24,
    { lineHeight: 20, fontSize: 16, bold: true },
  );
  y += 12;
  y = drawLines(
    gameOverContainer,
    [{ text: "The party has perished. The run is over." }],
    24,
    y,
  );
  drawLines(
    gameOverContainer,
    [
      {
        text: "Press Enter to start a new run, q to quit.",
        color: toPixiColor(theme.textMuted),
      },
    ],
    24,
    y + 8,
  );
}

/** Applies a game-over-phase key press: Enter starts a new run, quit returns to the title. */
function handleGameOverKeyDown(event: KeyboardEvent, state: GameState): void {
  const keyName = normalizeBrowserKey(event);
  if (!keyName) return;
  if (keyName === "enter") {
    store.dispatch({
      type: "NewGame",
      seed: Date.now(),
      classId: state.party[0].classId,
      permadeath: state.flags?.permadeath ?? false,
      name: state.party[0].name,
    });
    return;
  }
  if (resolveGlobalIntent(keyName)?.kind === "quit") {
    quitToTitle();
  }
}

/** Compact signed stat delta line for the store's backpack compare panel (mirrors `StoreView.tsx`'s `deltaLine`). */
function deltaLine(delta: {
  str: number;
  agi: number;
  vit: number;
  int: number;
}): string {
  const parts: string[] = [];
  for (const key of ["str", "agi", "vit", "int"] as const) {
    if (delta[key] !== 0) {
      parts.push(
        `${delta[key] >= 0 ? "+" : ""}${delta[key]} ${key.toUpperCase()}`,
      );
    }
  }
  return parts.length === 0 ? "no stat change" : parts.join(" ");
}

/** Village overview: party/gold summary plus the building/overworld picker. */
function buildVillageOverviewLines(
  state: GameState,
  overview: OverviewUiState,
): Line[] {
  const summary = state.party
    .map((member) => `${member.name} Lv${member.level}`)
    .join(", ");
  const lines: Line[] = [
    {
      text: `${summary} - ${state.gold} gold`,
      color: toPixiColor(theme.textMuted),
    },
    { text: "" },
  ];
  for (const [index, option] of OPTIONS.entries()) {
    const selected = index === overview.cursor;
    lines.push({
      text: `${selected ? "> " : "  "}[${option.shortcut}] ${option.label}`,
      color: selected ? toPixiColor(theme.accent) : undefined,
    });
  }
  lines.push({ text: "" });
  lines.push({
    text: "Controls: up/down + Enter, or i/c/s/t/o to act directly; 1-4 switch scenes; q to quit.",
    color: toPixiColor(theme.textMuted),
  });
  return lines;
}

/** Inn sub-view: rest cost preview. */
function buildInnLines(state: GameState): Line[] {
  const cost = state.party.length * INN_COST_PER_MEMBER;
  return [
    {
      text: `Resting fully restores the party's HP and MP for ${cost} gold (${INN_COST_PER_MEMBER} per member).`,
    },
    { text: "" },
    {
      text: "Press Enter to rest, Esc to go back.",
      color: toPixiColor(theme.textMuted),
    },
  ];
}

/** Church sub-view: save copy (saving itself is stashed - browser persistence is ROG-46). */
function buildChurchLines(): Line[] {
  return [
    { text: "Save your progress here. Saves load automatically on boot." },
    { text: "" },
    {
      text: "Press Enter to save, Esc to go back.",
      color: toPixiColor(theme.textMuted),
    },
  ];
}

/** Store sub-view: shop catalog or the selected member's backpack/equipment. */
function buildStoreLines(state: GameState, storeUi: StoreUiState): Line[] {
  const clampedMemberIndex = Math.min(
    storeUi.memberIndex,
    state.party.length - 1,
  );
  const member = state.party[clampedMemberIndex];
  const lines: Line[] = [
    { text: `Store - ${storeUi.mode === "shop" ? "Shop" : "Backpack"}` },
    {
      text: `${member.name} ATK ${atkFrom(member)} DEF ${defFrom(member)} SPD ${spdFrom(member)}`,
    },
    { text: "" },
  ];

  if (storeUi.mode === "shop") {
    for (const [index, item] of SHOP_ITEMS.entries()) {
      const selected = index === storeUi.shopCursor;
      const owned =
        state.inventory.find((entry) => entry.itemId === item.id)?.quantity ??
        0;
      lines.push({
        text: `${selected ? "> " : "  "}${item.name} - buy ${item.price}g / sell ${sellPriceFor(item)}g (owned ${owned})`,
        color: selected ? toPixiColor(theme.accent) : undefined,
      });
    }
    lines.push({ text: "" });
    lines.push({
      text: "Up/down to select, b to buy 1, s to sell 1, Tab for backpack, Esc to go back.",
      color: toPixiColor(theme.textMuted),
    });
    return lines;
  }

  const packEntries = buildPackEntries(member, state.items);
  const packIndex = Math.min(storeUi.packCursor, packEntries.length - 1);
  for (const [index, packEntry] of packEntries.entries()) {
    const selected = index === packIndex;
    if (packEntry.kind === "equipped") {
      const text = packEntry.item
        ? `${packEntry.label}: ${describeItem(packEntry.item)} (${itemStatLine(packEntry.item)}) [u to unequip]`
        : `${packEntry.label}: (empty)`;
      lines.push({
        text: `${selected ? "> " : "  "}${text}`,
        color: selected
          ? toPixiColor(theme.accent)
          : packEntry.item
            ? toPixiColor(theme.rarity[packEntry.item.rarity])
            : toPixiColor(theme.textFaint),
      });
    } else {
      lines.push({
        text: `${selected ? "> " : "  "}${describeItem(packEntry.item)} - ${itemStatLine(packEntry.item)} - sell ${itemSellPrice(packEntry.item)}g [e equip / s sell]`,
        color: selected
          ? toPixiColor(theme.accent)
          : toPixiColor(theme.rarity[packEntry.item.rarity]),
      });
    }
  }

  const selectedEntry = packEntries[packIndex];
  if (selectedEntry?.kind === "backpack") {
    const target = equipTargetSlot(member, selectedEntry.item);
    const targetLabel =
      EQUIP_SLOTS.find((entry) => entry.slot === target)?.label ?? "?";
    lines.push({
      text: `Equipping into ${targetLabel}: ${deltaLine(compareItem(member, selectedEntry.item))}`,
      color: toPixiColor(theme.gold),
    });
  } else {
    lines.push({
      text: "Select a backpack item to compare against its slot.",
      color: toPixiColor(theme.textMuted),
    });
  }
  lines.push({ text: "" });
  lines.push({
    text: "Up/down to select, e to equip, u to unequip, s to sell, Tab for shop, Esc to go back.",
    color: toPixiColor(theme.textMuted),
  });
  return lines;
}

/** Tavern sub-view: recruit pool or the current party's dismiss list. */
function buildTavernLines(state: GameState, tavernUi: TavernUiState): Line[] {
  const lines: Line[] = [
    {
      text: `Tavern - ${tavernUi.mode === "recruit" ? "Recruits" : "Party"}`,
    },
    { text: "" },
  ];

  if (tavernUi.mode === "recruit") {
    if (state.recruits.length === 0) {
      lines.push({
        text: "The tavern is empty right now.",
        color: toPixiColor(theme.textMuted),
      });
    } else {
      const cursor = Math.min(
        tavernUi.recruitCursor,
        state.recruits.length - 1,
      );
      for (const [index, recruit] of state.recruits.entries()) {
        const selected = index === cursor;
        lines.push({
          text: `${selected ? "> " : "  "}${recruit.name} the ${recruitClassName(recruit.classId)} - Lv${recruit.level} - ATK ${atkFrom(recruit)} DEF ${defFrom(recruit)} SPD ${spdFrom(recruit)} - ${recruitCost(recruit.level)}g`,
          color: selected ? toPixiColor(theme.accent) : undefined,
        });
      }
    }
    lines.push({ text: "" });
    lines.push({
      text: "Up/down to select, h/Enter to hire, Tab for party, Esc to go back.",
      color: toPixiColor(theme.textMuted),
    });
    return lines;
  }

  const cursor = Math.min(tavernUi.partyCursor, state.party.length - 1);
  for (const [index, member] of state.party.entries()) {
    const selected = index === cursor;
    const isHero = index === 0;
    const confirming = tavernUi.confirmId === member.id;
    const suffix = isHero
      ? " (hero, cannot dismiss)"
      : confirming
        ? " - Dismiss? (y/n)"
        : "";
    lines.push({
      text: `${selected ? "> " : "  "}${member.name} the ${recruitClassName(member.classId)} - Lv${member.level}${suffix}`,
      color: selected ? toPixiColor(theme.accent) : undefined,
    });
  }
  lines.push({ text: "" });
  lines.push({
    text: "Up/down to select, d/Enter to dismiss, Tab for recruits, Esc to go back.",
    color: toPixiColor(theme.textMuted),
  });
  return lines;
}

const villageContentContainer = new Container();
entries.village.contentContainer.addChild(villageContentContainer);

/** Draws the village scene's real content: overview or whichever building has focus. */
function renderVillageContent(state: GameState): void {
  if (state.scene !== "village") return;
  clearContainer(villageContentContainer);

  const village = keyboardManager.getState().village;
  let lines: Line[];
  switch (village.building) {
    case "inn":
      lines = buildInnLines(state);
      break;
    case "church":
      lines = buildChurchLines();
      break;
    case "store":
      lines = buildStoreLines(state, village.store);
      break;
    case "tavern":
      lines = buildTavernLines(state, village.tavern);
      break;
    default:
      lines = buildVillageOverviewLines(state, village.overview);
      break;
  }
  drawLines(villageContentContainer, lines, 8, 8);
}

/**
 * Draws the overworld scene's real content: sprite tilemap camera viewport,
 * minimap, and encounter meter (ROG-49). Mirrors `renderVillageContent`'s
 * guard/shape, but delegates the actual drawing to `OverworldSceneView`
 * (framework-free, unit-tested in `overworldView.test.ts`) instead of
 * building `Text` lines directly.
 */
function renderOverworldContent(state: GameState): void {
  if (state.scene !== "overworld") return;
  if (!overworldView) return;
  const map = overworldMapFor(state);
  const rect = contentRects.overworld;
  overworldView.render(
    state,
    map,
    { width: rect.width, height: rect.height },
    OVERWORLD_TILE_PX,
  );
}

/**
 * Draws the battle scene's real content: enemy sprites/fallback rects with
 * name/HP plates, the target-mode selection highlight, the action/skill/
 * item/target command menu, and HP-delta-derived floating damage numbers
 * (ROG-51). Mirrors `renderOverworldContent`'s guard/shape, delegating to
 * `BattleSceneView` (framework-free, unit-tested in `battleView.test.ts`).
 * Menu/cursor state is read from `keyboardManager.getState().battle`, the
 * same `BrowserKeyboardManager` focus state `renderVillageContent` already
 * reads for the village's building focus - `handleBattle` (ROG-45) already
 * reduces this state machine and dispatches the resulting battle events, so
 * this function only needs to draw it.
 */
function renderBattleContent(state: GameState): void {
  if (state.scene !== "battle") return;
  if (!battleView) return;
  const rect = contentRects.battle;
  battleView.render(
    state,
    { width: rect.width, height: rect.height },
    keyboardManager.getState().battle,
  );
}

/**
 * Draws the dungeon scene's real content: the textured-raycast first-person
 * view (walls/floor/ceiling/billboards), a graphical minimap corner, and a
 * facing/status readout (ROG-50). Mirrors `renderOverworldContent`'s guard/
 * shape, delegating to `DungeonSceneView` (framework-free, unit-tested in
 * `dungeonView.test.ts`).
 */
function renderDungeonContent(state: GameState): void {
  if (state.scene !== "dungeon") return;
  if (!dungeonView) return;
  if (!state.dungeonState) return;
  const rect = contentRects.dungeon;
  dungeonView.render(state.dungeonState, {
    width: rect.width,
    height: rect.height,
  });
}

/**
 * Redraws whatever should be visible for the current `phase`/game-over/scene
 * state. Called both from `store.subscribe` (a `GameStore` dispatch) and at
 * the end of every keydown, since local-only UI state (menu cursors, which
 * village building has focus, title flow transitions) doesn't dispatch a
 * `GameEvent` and would otherwise never redraw. Bails out first when
 * `fatalIncident` is set (ROG-48) - the crash overlay is already showing
 * itself (see the `subscribeIncidents` callback above), so there is nothing
 * else to draw, exactly like the terminal's `if (fatal) return
 * <CrashScreen/>` short-circuit in `app.tsx`.
 */
function renderCurrent(): void {
  if (fatalIncident) return;
  const state = store.getState();
  const gameOver = phase === "playing" && (state.flags?.gameOver ?? false);
  titleContainer.visible = phase === "title";
  gameOverContainer.visible = gameOver;

  if (phase === "title") {
    for (const scene of SCENE_ORDER) entries[scene].container.visible = false;
    renderTitle();
    return;
  }
  if (gameOver) {
    for (const scene of SCENE_ORDER) entries[scene].container.visible = false;
    renderGameOverView();
    return;
  }
  switcher.render(state);
  renderChrome(state);
  renderVillageContent(state);
  renderOverworldContent(state);
  renderBattleContent(state);
  renderDungeonContent(state);

  if (devConsole && devConsoleOverlay) {
    devConsoleOverlay.setVisible(devConsole.isOpen());
    if (devConsole.isOpen()) {
      devConsoleOverlay.render(
        state,
        devConsole.getOutput(),
        devConsole.getInput(),
      );
    }
  }
}

/**
 * Keyboard input manager with scene focus routing (ROG-45). Scene hotkeys
 * (1-4) and quit go through the same `globalInput` keymap `app.tsx` uses;
 * everything else routes to whichever scene - and, inside the village,
 * whichever sub-view - currently has focus, via the exact same
 * `interaction.ts` modules the Ink screens use. `onQuit` (ROG-52) returns
 * to the browser's own title screen, since there is no OS process for
 * "quit" to exit here. Declared before the first `renderCurrent()` call
 * below, since `renderVillageContent` reads its state. The dev-console
 * toggle key is intercepted before it ever reaches this manager (see the
 * keydown listener at the bottom of this module), so its own
 * `toggleConsole` handling only fires when no browser dev console exists
 * (i.e. `--dev`/`?dev` wasn't set).
 */
const keyboardManager = new BrowserKeyboardManager(store, quitToTitle, () => {
  hasSave = true;
});

/**
 * Browser dev console (ROG-48): gated on `--dev`/`?dev`, exactly like the
 * terminal's `devConsoleEnabled`. `undefined` when disabled, so every
 * dev-console branch below is a no-op in a normal build - the backtick key
 * falls through to `keyboardManager`'s existing stash in that case.
 */
const devConsole = flags.dev
  ? new BrowserDevConsole(store, {
      crash: (message) =>
        store.reportFailure("manual", new Error(message), true),
    })
  : undefined;
const devConsoleOverlay = flags.dev
  ? new DevConsoleOverlayView(document.body)
  : undefined;

/**
 * Clears the browser save once the game is over, matching `app.tsx`'s
 * `useEffect(() => { if (gameOver) ... clearSave() }, [gameOver])` - so the
 * next boot (or title "New Game") starts a fresh run instead of reloading
 * the dead game-over state. `store.subscribe` fires on every dispatch, so
 * `clearedForGameOver` guards against re-clearing (and re-flipping
 * `hasSave`) on every subsequent redraw while still on the game-over screen.
 */
let clearedForGameOver = false;
store.subscribe(() => {
  const gameOver = store.getState().flags?.gameOver ?? false;
  if (gameOver && !clearedForGameOver) {
    clearedForGameOver = true;
    hasSave = false;
    clearBrowserSave().catch((error) => {
      store.reportFailure("clear", error, false);
    });
  } else if (!gameOver) {
    clearedForGameOver = false;
  }
  renderCurrent();
});
app.renderer.on("resize", () => renderCurrent());
renderCurrent();

function updateMinSizeOverlay(): void {
  const tooSmall =
    window.innerWidth < MIN_WIDTH || window.innerHeight < MIN_HEIGHT;
  overlay.style.display = tooSmall ? "flex" : "none";
  overlay.textContent = tooSmall
    ? `Window too small - resize to at least ${MIN_WIDTH}x${MIN_HEIGHT}px (current: ${window.innerWidth}x${window.innerHeight})`
    : "";
}
window.addEventListener("resize", updateMinSizeOverlay);
updateMinSizeOverlay();

/**
 * Routes every keydown to the dev console (if open, or being opened/closed
 * by backtick), then the phase currently showing (title, game-over, or the
 * normal scene-focus routing), then always redraws - see `renderCurrent`'s
 * doc comment for why a redraw is needed even when no `GameEvent` was
 * dispatched. A fatal incident (ROG-48) blocks every branch below, matching
 * the terminal's `isActive: !fatal` on each of its `useInput` hooks -
 * there's nothing to route input to once the crash overlay is showing; its
 * only interactive element is its own Restart button.
 */
window.addEventListener("keydown", (event) => {
  if (devConsole) {
    const keyName = normalizeBrowserKey(event);
    if (keyName === "`" && !fatalIncident) {
      devConsole.toggle();
      renderCurrent();
      return;
    }
    if (devConsole.isOpen()) {
      if (!fatalIncident) devConsole.handleKeyDown(event);
      renderCurrent();
      return;
    }
  }
  if (fatalIncident) return;
  if (phase === "title") {
    handleTitleKeyDown(event);
  } else {
    const state = store.getState();
    if (state.flags?.gameOver) {
      handleGameOverKeyDown(event, state);
    } else {
      keyboardManager.handleKeyDown(event);
    }
  }
  renderCurrent();
});

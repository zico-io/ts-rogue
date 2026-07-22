import { Application, Container, Sprite, Text } from "pixi.js";
import { GameStore, newGame } from "../engine/state/store";
import type { GameState, Scene } from "../engine/state/types";
import { theme, toPixiColor } from "../ui/theme";
import { loadAtlas } from "./atlas";
import { parseBootFlags } from "./boot";
import { BrowserKeyboardManager } from "./input/keyboard";
import { createPixiDrawFactory } from "./render/pixiDrawFactory";
import { SceneChromeView } from "./render/sceneView";
import { SCENE_ORDER, SceneSwitcher, type SceneView } from "./scenes";

const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;
/** Native atlas tiles are 12x12; scale up so pixel art reads clearly on a modern display. */
const PREVIEW_SCALE = 6;

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

// TODO(ROG-46): load a saved game via browser (IndexedDB) persistence instead
// of always starting fresh, once that issue lands.
let store: GameStore;
try {
  store = new GameStore(newGame(flags.seed));
} catch (error) {
  showCrash("boot", error);
  throw error;
}
store.subscribeIncidents((incident) =>
  showCrash(incident.category, incident.message),
);

const app = new Application();
await app.init({
  resizeTo: mount,
  backgroundColor: "#000000",
  antialias: true,
});
mount.appendChild(app.canvas);

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

/**
 * Rebuilds every scene's HUD chrome (frame, party bar, message log) at the
 * canvas's current size and repositions each scene's content container to
 * the chrome's computed content rect, so a resize or a dispatch that
 * changes HP/MP/log always redraws the frame around up-to-date content.
 */
function renderChrome(state: GameState): void {
  const size = { width: app.screen.width, height: app.screen.height };
  for (const scene of SCENE_ORDER) {
    const entry = entries[scene];
    const contentRect = entry.chrome.render(state, size, {
      title: sceneTitle(scene),
    });
    entry.contentContainer.position.set(contentRect.x, contentRect.y);
  }
}

function renderState(state: GameState): void {
  switcher.render(state);
  renderChrome(state);
}

store.subscribe(renderState);
renderState(store.getState());
app.renderer.on("resize", () => renderChrome(store.getState()));

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
  showCrash("atlas", error);
}

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

if (flags.dev) {
  // Stashed for ROG-48's browser dev console; no console UI in this issue.
  console.info("ts-rogue: dev flag set (no browser dev console yet)");
}

/**
 * Keyboard input manager with scene focus routing (ROG-45). Scene hotkeys
 * (1-4), the dev-console toggle, and quit go through the same
 * `globalInput` keymap `app.tsx` uses; everything else routes to whichever
 * scene - and, inside the village, whichever sub-view - currently has
 * focus, via the exact same `interaction.ts` modules the Ink screens use.
 * No visual focus indicator exists yet (real per-scene rendering is ROG-49
 * through ROG-52), but the routed state is real and drives subsequent key
 * presses correctly.
 */
const keyboardManager = new BrowserKeyboardManager(store);
window.addEventListener("keydown", (event) => {
  keyboardManager.handleKeyDown(event);
});

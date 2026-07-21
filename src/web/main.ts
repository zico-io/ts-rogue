import { Application, Container, Text } from "pixi.js";
import { GameStore, newGame } from "../engine/state/store";
import type { GameState, Scene } from "../engine/state/types";
import { theme, toPixiColor } from "../ui/theme";
import { parseBootFlags } from "./boot";
import { SCENE_ORDER, SceneSwitcher, type SceneView } from "./scenes";

const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;

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

/** Builds one scene's container plus the label-driven view `SceneSwitcher` uses. */
function buildSceneView(scene: Scene): SceneView {
  const container = new Container();
  container.visible = false;
  const label = new Text({
    text: scene,
    style: {
      fill: toPixiColor(theme.text),
      fontSize: 20,
      fontFamily: "monospace",
    },
  });
  label.position.set(24, 24);
  container.addChild(label);
  app.stage.addChild(container);
  return {
    setVisible(visible: boolean) {
      container.visible = visible;
    },
    setLabel(text: string) {
      label.text = text;
    },
  };
}

const views = Object.fromEntries(
  SCENE_ORDER.map((scene) => [scene, buildSceneView(scene)]),
) as Record<Scene, SceneView>;
const switcher = new SceneSwitcher(views);

function renderState(state: GameState): void {
  switcher.render(state);
}

store.subscribe(renderState);
renderState(store.getState());

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

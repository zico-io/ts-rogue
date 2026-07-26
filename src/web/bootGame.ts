import { Application, Container, Text } from "pixi.js";
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
import { activatedWaypointList } from "../engine/world/waypoints";
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
import { loadBattlerTextures } from "./battlers";
import type { BootFlags } from "./boot";
import { BrowserDevConsole } from "./devConsole";
import { loadHudFont } from "./font";
import { BrowserKeyboardManager } from "./input/keyboard";
import { normalizeBrowserKey } from "./input/normalizeBrowserKey";
import { BattleSceneView } from "./render/battleView";
import { createPaletteGrade } from "./render/colorGrade";
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

const DEFAULT_HERO_NAME = "Hero";

const MENU_BASE_FONT_PX = 14;
const MENU_BASE_LOGO_FONT_PX = 16;
const MENU_BASE_LINE_HEIGHT_PX = 18;
const MENU_BASE_LOGO_LINE_HEIGHT_PX = 20;
const MENU_BASE_MARGIN_PX = 24;
const MENU_BASE_VILLAGE_MARGIN_PX = 8;
const MENU_BASELINE_WIDTH_PX = 960;

const MENU_SCALE_MAX = 1.8;

interface MenuLayout {
  fontSize: number;
  logoFontSize: number;
  lineHeight: number;
  logoLineHeight: number;
  margin: number;
  villageMargin: number;
}

function menuLayout(pixelSize: { width: number; height: number }): MenuLayout {
  const scale = Math.max(
    1,
    Math.min(MENU_SCALE_MAX, pixelSize.width / MENU_BASELINE_WIDTH_PX),
  );
  return {
    fontSize: Math.round(MENU_BASE_FONT_PX * scale),
    logoFontSize: Math.round(MENU_BASE_LOGO_FONT_PX * scale),
    lineHeight: Math.round(MENU_BASE_LINE_HEIGHT_PX * scale),
    logoLineHeight: Math.round(MENU_BASE_LOGO_LINE_HEIGHT_PX * scale),
    margin: Math.round(MENU_BASE_MARGIN_PX * scale),
    villageMargin: Math.round(MENU_BASE_VILLAGE_MARGIN_PX * scale),
  };
}

export interface BootHandle {
  dispose(): void;
}

export async function bootGame(
  mount: HTMLElement,
  flags: BootFlags,
): Promise<BootHandle> {
  const disposers: Array<() => void> = [];
  function on<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): void {
    window.addEventListener(type, handler);
    disposers.push(() => window.removeEventListener(type, handler));
  }

  if (!mount.style.position) mount.style.position = "relative";

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    color: "#e5e515",
    background: "#000",
    fontFamily: "monospace",
    fontSize: "16px",
    textAlign: "center",
    padding: "1em",
    zIndex: "1100",
  });
  mount.appendChild(overlay);

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

  let hasSave = savedGame !== undefined;

  let store: GameStore;
  try {
    store = new GameStore(savedGame ?? newGame(flags.seed));
  } catch (error) {
    showCrash("boot", error);
    throw error;
  }

  let fatalIncident: GameIncident | undefined;
  const crashOverlay = new CrashOverlayView(mount, () =>
    window.location.reload(),
  );
  store.subscribeIncidents((incident) => {
    if (!incident.fatal) return;
    fatalIncident = incident;
    crashOverlay.show(incident);
  });

  on("error", (event) => {
    store.reportFailure(
      "uncaught-exception",
      event.error ?? event.message,
      true,
    );
  });
  on("unhandledrejection", (event) => {
    store.reportFailure("unhandled-rejection", event.reason, true);
  });

  const app = new Application();
  await app.init({
    resizeTo: mount,

    backgroundColor: theme.background,
    antialias: true,

    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  mount.appendChild(app.canvas);

  app.stage.filters = createPaletteGrade();

  await loadHudFont();

  const portalResizeObserver = new ResizeObserver(() => {
    app.renderer.resize(mount.clientWidth, mount.clientHeight);
  });
  portalResizeObserver.observe(mount);
  disposers.push(() => portalResizeObserver.disconnect());

  type Phase = "title" | "playing";
  let phase: Phase = "title";

  let titleUi: TitleUiState = {
    view: "menu",
    menuCursor: 0,
    classCursor: 0,
    modeCursor: 0,
    nameInput: "",
  };

  function resetTitleUi(): void {
    titleUi = {
      view: "menu",
      menuCursor: 0,
      classCursor: 0,
      modeCursor: 0,
      nameInput: "",
    };
  }

  function quitToTitle(): void {
    phase = "title";
    resetTitleUi();
  }

  function sceneTitle(scene: Scene): string {
    return scene.charAt(0).toUpperCase() + scene.slice(1);
  }

  interface SceneEntry {
    container: Container;
    contentContainer: Container;
    chrome: SceneChromeView;
    view: SceneView;

    label: Text;
  }

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

  entries.village.label.visible = false;

  entries.overworld.label.visible = false;

  entries.battle.label.visible = false;

  entries.dungeon.label.visible = false;

  const contentRects = Object.fromEntries(
    SCENE_ORDER.map((scene) => [
      scene,
      { x: 0, y: 0, width: 0, height: 0 } satisfies ContentRect,
    ]),
  ) as Record<Scene, ContentRect>;

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

  const OVERWORLD_TARGET_COLS = 22;
  const OVERWORLD_MIN_TILE_PX = 20;
  const OVERWORLD_MAX_TILE_PX = 40;

  function overworldTilePx(availableWidth: number): number {
    return Math.max(
      OVERWORLD_MIN_TILE_PX,
      Math.min(
        OVERWORLD_MAX_TILE_PX,
        Math.round(availableWidth / OVERWORLD_TARGET_COLS),
      ),
    );
  }

  let overworldView: OverworldSceneView | undefined;

  const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const applyReducedMotion = (reduced: boolean) =>
    overworldView?.setReducedMotion(reduced);
  const handleReducedMotionChange = (event: MediaQueryListEvent) =>
    applyReducedMotion(event.matches);
  reducedMotionQuery.addEventListener("change", handleReducedMotionChange);
  disposers.push(() =>
    reducedMotionQuery.removeEventListener("change", handleReducedMotionChange),
  );

  async function setupOverworldView(): Promise<void> {
    const sheet = await loadAtlas();
    const factory = createPixiOverworldDrawFactory(
      entries.overworld.contentContainer,
      sheet,
    );
    overworldView = new OverworldSceneView(factory);
    applyReducedMotion(reducedMotionQuery.matches);
  }
  try {
    await setupOverworldView();
  } catch (error) {
    store.reportFailure("overworld-view", error, true);
  }

  app.ticker.add((ticker) => overworldView?.tick(ticker.deltaMS));

  let battleView: BattleSceneView | undefined;

  async function setupBattleView(): Promise<void> {
    const textures = await loadBattlerTextures();
    const factory = createPixiBattleDrawFactory(
      entries.battle.contentContainer,
      textures,
    );
    battleView = new BattleSceneView(factory);
  }
  try {
    await setupBattleView();
  } catch (error) {
    store.reportFailure("battle-view", error, true);
  }

  app.ticker.add((ticker) => battleView?.tick(ticker.deltaMS));

  let dungeonView: DungeonSceneView | undefined;

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

  function overworldMapFor(state: GameState): OverworldMap {
    if (cachedOverworldMap && cachedOverworldSeed === state.seed) {
      return cachedOverworldMap;
    }
    cachedOverworldMap = generateOverworldMap(state.seed);
    cachedOverworldSeed = state.seed;
    return cachedOverworldMap;
  }

  interface Line {
    text: string;
    color?: number;
  }

  function clearContainer(container: Container): void {
    for (const child of container.removeChildren()) child.destroy();
  }

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

  function renderTitle(): void {
    clearContainer(titleContainer);
    const layout = menuLayout({
      width: app.screen.width,
      height: app.screen.height,
    });

    const panelFactory = createPixiDrawFactory(titleContainer);
    const panelBorder = panelFactory.createRect();
    panelBorder.setPosition(0, 0);
    panelBorder.setSize(app.screen.width, app.screen.height);
    panelBorder.setColor(toPixiColor(theme.borderFocus));

    const panelBackground = panelFactory.createRect({ bevel: true });
    panelBackground.setPosition(layout.margin, layout.margin);
    panelBackground.setSize(
      Math.max(0, app.screen.width - layout.margin * 2),
      Math.max(0, app.screen.height - layout.margin * 2),
    );
    panelBackground.setColor(toPixiColor(theme.window.fill));

    let y = drawLines(
      titleContainer,
      LOGO.map((text, index) => ({
        text,
        color: toPixiColor(theme.logoGradient[index]),
      })),
      layout.margin,
      layout.margin,
      {
        lineHeight: layout.logoLineHeight,
        fontSize: layout.logoFontSize,
        bold: true,
      },
    );
    y = drawLines(
      titleContainer,
      [
        {
          text: "A terminal dungeon crawler.",
          color: toPixiColor(theme.textMuted),
        },
      ],
      layout.margin,
      y + 6,
      { fontSize: layout.fontSize, lineHeight: layout.lineHeight },
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
          color:
            titleUi.modeCursor === 0 ? toPixiColor(theme.accent) : undefined,
        });
        lines.push({
          text: `${titleUi.modeCursor === 1 ? "> " : "  "}Permadeath - one life, one run`,
          color:
            titleUi.modeCursor === 1 ? toPixiColor(theme.accent) : undefined,
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
    y = drawLines(titleContainer, lines, layout.margin, y, {
      fontSize: layout.fontSize,
      lineHeight: layout.lineHeight,
    });
    drawLines(
      titleContainer,
      [{ text: hint, color: toPixiColor(theme.textMuted) }],
      layout.margin,
      y + 8,
      { fontSize: layout.fontSize, lineHeight: layout.lineHeight },
    );
  }

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

          seed: flags.seed,
          classId: result.effect.classId,
          permadeath: result.effect.permadeath,
          name: result.effect.name,
        });
        phase = "playing";
        break;
      case "continueGame":
        phase = "playing";
        break;
      case "openSettings":
        store.dispatch({
          type: "Log",
          message: "Settings aren't available in the browser yet",
        });
        break;
      case "quit":
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

  function renderGameOverView(): void {
    clearContainer(gameOverContainer);
    const layout = menuLayout({
      width: app.screen.width,
      height: app.screen.height,
    });
    let y = drawLines(
      gameOverContainer,
      BANNER.map((text, index) => ({
        text,
        color: toPixiColor(theme.gameOverGradient[index]),
      })),
      layout.margin,
      layout.margin,
      {
        lineHeight: layout.logoLineHeight,
        fontSize: layout.logoFontSize,
        bold: true,
      },
    );
    y += 12;
    y = drawLines(
      gameOverContainer,
      [{ text: "The party has perished. The run is over." }],
      layout.margin,
      y,
      { fontSize: layout.fontSize, lineHeight: layout.lineHeight },
    );
    drawLines(
      gameOverContainer,
      [
        {
          text: "Press Enter to start a new run, q to quit.",
          color: toPixiColor(theme.textMuted),
        },
      ],
      layout.margin,
      y + 8,
      { fontSize: layout.fontSize, lineHeight: layout.lineHeight },
    );
  }

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
          ? `${packEntry.label}: ${describeItem(packEntry.item)} (${itemStatLine(packEntry.item)})`
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
          text: `${selected ? "> " : "  "}${describeItem(packEntry.item)} - ${itemStatLine(packEntry.item)} - sell ${itemSellPrice(packEntry.item)}g [s sell]`,
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
      text: "Up/down to select, s to sell, Tab for shop, Esc to go back.",
      color: toPixiColor(theme.textMuted),
    });
    return lines;
  }

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

    const rect = contentRects.village;
    const layout = menuLayout(rect);
    const blockHeight = lines.length * layout.lineHeight;
    const marginTop = Math.max(
      layout.villageMargin,
      (rect.height - blockHeight) / 2,
    );
    drawLines(villageContentContainer, lines, layout.villageMargin, marginTop, {
      fontSize: layout.fontSize,
      lineHeight: layout.lineHeight,
    });
  }

  const zoomContainer = new Container();
  zoomContainer.visible = false;
  app.stage.addChild(zoomContainer);

  function renderZoomOverlay(state: GameState): void {
    const zoom = keyboardManager.getState().zoom;
    zoomContainer.visible = zoom.open;
    if (!zoom.open) return;
    clearContainer(zoomContainer);

    const panelFactory = createPixiDrawFactory(zoomContainer);
    const panelBorder = panelFactory.createRect();
    panelBorder.setPosition(0, 0);
    panelBorder.setSize(app.screen.width, app.screen.height);
    panelBorder.setColor(toPixiColor(theme.borderFocus));

    const layout = menuLayout({
      width: app.screen.width,
      height: app.screen.height,
    });
    const panelBackground = panelFactory.createRect({ bevel: true });
    panelBackground.setPosition(layout.margin, layout.margin);
    panelBackground.setSize(
      Math.max(0, app.screen.width - layout.margin * 2),
      Math.max(0, app.screen.height - layout.margin * 2),
    );
    panelBackground.setColor(toPixiColor(theme.window.fill));

    const map = overworldMapFor(state);
    const waypoints = activatedWaypointList(map, state.activatedWaypoints);
    const lines: Line[] = [
      { text: "Fast Travel", color: toPixiColor(theme.title) },
      { text: "" },
    ];
    if (waypoints.length === 0) {
      lines.push({
        text: "(no destinations discovered yet)",
        color: toPixiColor(theme.textMuted),
      });
    } else {
      for (const [index, waypoint] of waypoints.entries()) {
        const selected = index === zoom.ui.cursor;
        lines.push({
          text: `${selected ? "> " : "  "}${waypoint.label} (tier ${waypoint.tier})`,
          color: selected ? toPixiColor(theme.accent) : undefined,
        });
      }
    }
    lines.push({ text: "" });
    lines.push({
      text: "Up/Down to choose, Enter to travel, Esc to cancel.",
      color: toPixiColor(theme.textMuted),
    });

    drawLines(zoomContainer, lines, layout.margin, layout.margin, {
      fontSize: layout.fontSize,
      lineHeight: layout.lineHeight,
    });
  }

  function renderOverworldContent(state: GameState): void {
    if (state.scene !== "overworld") return;
    if (!overworldView) return;
    const map = overworldMapFor(state);
    const rect = contentRects.overworld;
    overworldView.render(
      state,
      map,
      { width: rect.width, height: rect.height },
      overworldTilePx(rect.width),
      flags.dev
        ? { name: "multiCellFixture", originCol: 1, originRow: 1 }
        : undefined,
    );
  }

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

  function renderDungeonContent(state: GameState): void {
    if (state.scene !== "dungeon") return;
    if (!dungeonView) return;
    if (!state.dungeonState) return;
    const rect = contentRects.dungeon;
    dungeonView.render(
      state.dungeonState,
      { width: rect.width, height: rect.height },
      keyboardManager.getState().dungeon.confirmingExit ?? false,
    );
  }

  function renderCurrent(): void {
    if (fatalIncident) return;
    const state = store.getState();
    const gameOver = phase === "playing" && (state.flags?.gameOver ?? false);
    titleContainer.visible = phase === "title";
    gameOverContainer.visible = gameOver;

    if (phase === "title") {
      for (const scene of SCENE_ORDER) entries[scene].container.visible = false;
      zoomContainer.visible = false;
      renderTitle();
      return;
    }
    if (gameOver) {
      for (const scene of SCENE_ORDER) entries[scene].container.visible = false;
      zoomContainer.visible = false;
      renderGameOverView();
      return;
    }
    switcher.render(state);
    renderChrome(state);
    renderVillageContent(state);
    renderOverworldContent(state);
    renderBattleContent(state);
    renderDungeonContent(state);
    renderZoomOverlay(state);

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

  const keyboardManager = new BrowserKeyboardManager(store, quitToTitle, () => {
    hasSave = true;
  });

  const devConsole = flags.dev
    ? new BrowserDevConsole(store, {
        crash: (message) =>
          store.reportFailure("manual", new Error(message), true),
      })
    : undefined;
  const devConsoleOverlay = flags.dev
    ? new DevConsoleOverlayView(mount)
    : undefined;

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
  function updateMinSizeOverlay(): void {
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const tooSmall = width < MIN_WIDTH || height < MIN_HEIGHT;
    overlay.style.display = tooSmall ? "flex" : "none";
    overlay.textContent = tooSmall
      ? `Portal too small - the window needs room for at least a ${MIN_WIDTH}x${MIN_HEIGHT}px portal (current: ${width}x${height})`
      : "";
  }

  app.renderer.on("resize", () => {
    renderCurrent();
    updateMinSizeOverlay();
  });
  on("resize", updateMinSizeOverlay);
  renderCurrent();
  updateMinSizeOverlay();

  on("keydown", (event) => {
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

  return {
    dispose() {
      for (const dispose of disposers) dispose();
      app.destroy(true, { children: true });
      mount.replaceChildren();
    },
  };
}

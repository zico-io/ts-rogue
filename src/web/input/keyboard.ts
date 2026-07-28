import { classSkills } from "../../engine/combat/skills";
import { isUsableBattleItem } from "../../engine/loot/consumables";
import type { GameStore } from "../../engine/state/store";
import { generateOverworldMap } from "../../engine/world/overworld";
import { activatedWaypointList } from "../../engine/world/waypoints";
import { saveGame } from "../../persistence/browserSave";
import { resolveGlobalIntent } from "../../ui/scene/globalInput";
import type { KeyName } from "../../ui/scene/input";
import {
  type BattleUiState,
  INITIAL_BATTLE_UI_STATE,
  reduceBattleUi,
  resolveBattleIntent,
} from "../../ui/screens/battle/interaction";
import {
  type DungeonUiState,
  reduceDungeonUi,
  resolveDungeonIntent,
} from "../../ui/screens/dungeon/interaction";
import {
  type OverworldUiState,
  reduceOverworldUi,
  resolveOverworldIntent,
} from "../../ui/screens/overworld/interaction";
import {
  buildPackEntries,
  buildShopRows,
  INITIAL_STORE_UI_STATE,
  INITIAL_TAVERN_UI_STATE,
  type OverviewUiState,
  reduceChurchUi,
  reduceInnUi,
  reduceOverviewUi,
  reduceStoreUi,
  reduceTavernUi,
  resolveChurchIntent,
  resolveInnIntent,
  resolveOverviewIntent,
  resolveStoreIntent,
  resolveTavernIntent,
  type StoreUiState,
  type TavernUiState,
} from "../../ui/screens/village/interaction";
import type { VillageBuilding } from "../../ui/screens/village/types";
import {
  reduceZoomUi,
  resolveZoomIntent,
  type ZoomUiState,
} from "../../ui/screens/zoom/interaction";
import {
  type BrowserKeyEvent,
  normalizeBrowserKey,
} from "./normalizeBrowserKey";

export interface VillageFocusState {
  building: VillageBuilding | null;
  overview: OverviewUiState;
  store: StoreUiState;
  tavern: TavernUiState;
}

export interface ZoomFocusState {
  open: boolean;
  ui: ZoomUiState;
}

const INITIAL_ZOOM_FOCUS: ZoomFocusState = { open: false, ui: { cursor: 0 } };

export interface KeyboardManagerState {
  overworld: OverworldUiState;
  dungeon: DungeonUiState;
  battle: BattleUiState;
  village: VillageFocusState;
  zoom: ZoomFocusState;
}

const INITIAL_VILLAGE_FOCUS: VillageFocusState = {
  building: null,
  overview: { cursor: 0 },
  store: INITIAL_STORE_UI_STATE,
  tavern: INITIAL_TAVERN_UI_STATE,
};

export function createInitialKeyboardManagerState(): KeyboardManagerState {
  return {
    overworld: {},
    dungeon: {},
    battle: INITIAL_BATTLE_UI_STATE,
    village: INITIAL_VILLAGE_FOCUS,
    zoom: INITIAL_ZOOM_FOCUS,
  };
}

export class BrowserKeyboardManager {
  private state: KeyboardManagerState = createInitialKeyboardManagerState();

  constructor(
    private readonly store: GameStore,

    private readonly onQuit: () => void,

    private readonly onSaved?: () => void,
  ) {}

  getState(): KeyboardManagerState {
    return this.state;
  }

  handleKeyDown(event: BrowserKeyEvent): void {
    const keyName = normalizeBrowserKey(event);
    if (!keyName) return;

    if (this.state.zoom.open) {
      this.handleZoom(keyName);
      return;
    }

    const globalIntent = resolveGlobalIntent(keyName);
    if (globalIntent) {
      this.applyGlobalIntent(globalIntent);
      return;
    }

    switch (this.store.getState().scene) {
      case "overworld":
        this.handleOverworld(keyName);
        break;
      case "dungeon":
        this.handleDungeon(keyName);
        break;
      case "battle":
        this.handleBattle(keyName);
        break;
      case "village":
        this.handleVillage(keyName);
        break;
    }
  }

  private applyGlobalIntent(
    intent: NonNullable<ReturnType<typeof resolveGlobalIntent>>,
  ): void {
    switch (intent.kind) {
      case "changeScene":
        this.store.dispatch({ type: "ChangeScene", scene: intent.scene });
        break;
      case "toggleConsole":
        console.info(
          "ts-rogue: dev-console toggle key pressed (no browser dev console yet)",
        );
        break;
      case "openZoom":
        this.tryOpenZoom();
        break;
      case "quit":
        this.onQuit();
        break;
      default:
        break;
    }
  }

  private tryOpenZoom(): void {
    const scene = this.store.getState().scene;
    if (scene !== "village" && scene !== "overworld") return;
    this.state = { ...this.state, zoom: { open: true, ui: { cursor: 0 } } };
  }

  private handleZoom(key: KeyName): void {
    const intent = resolveZoomIntent(key);
    if (!intent) return;
    const state = this.store.getState();
    const map = generateOverworldMap(state.seed);
    const waypoints = activatedWaypointList(map, state.activatedWaypoints);
    const result = reduceZoomUi(this.state.zoom.ui, intent, {
      count: waypoints.length,
    });
    switch (result.effect?.type) {
      case "travel":
        this.store.dispatch({
          type: "Zoom",
          waypointId: waypoints[result.effect.index].id,
        });
        this.state = { ...this.state, zoom: INITIAL_ZOOM_FOCUS };
        return;
      case "close":
        this.state = { ...this.state, zoom: INITIAL_ZOOM_FOCUS };
        return;
      default:
        break;
    }
    this.state = {
      ...this.state,
      zoom: { ...this.state.zoom, ui: result.state },
    };
  }

  private handleOverworld(key: KeyName): void {
    const intent = resolveOverworldIntent(key);
    if (!intent) return;
    const result = reduceOverworldUi(this.state.overworld, intent);
    if (result.effect?.type === "move") {
      this.store.dispatch({
        type: "MoveOverworld",
        dx: result.effect.dx,
        dy: result.effect.dy,
      });
    } else if (result.effect?.type === "leaveToVillage") {
      this.store.dispatch({ type: "ChangeScene", scene: "village" });
    }
    this.state = { ...this.state, overworld: result.state };
  }

  private handleDungeon(key: KeyName): void {
    const intent = resolveDungeonIntent(
      key,
      this.state.dungeon.confirmingExit ?? false,
    );
    if (!intent) return;
    const result = reduceDungeonUi(this.state.dungeon, intent);
    switch (result.effect?.type) {
      case "step":
        this.store.dispatch({
          type: "StepDungeon",
          direction: result.effect.direction,
        });
        break;
      case "turn":
        this.store.dispatch({
          type: "TurnDungeon",
          direction: result.effect.direction,
        });
        break;
      case "openChest":
        this.store.dispatch({ type: "OpenChest" });
        break;
      case "descend":
        this.store.dispatch({ type: "DescendStairs" });
        break;
      case "exit":
        this.store.dispatch({ type: "ExitDungeon" });
        break;
      default:
        break;
    }
    this.state = { ...this.state, dungeon: result.state };
  }

  private handleBattle(key: KeyName): void {
    const intent = resolveBattleIntent(key);
    if (!intent) return;

    const state = this.store.getState();
    const bs = state.battleState;
    if (bs?.status !== "ongoing" || !bs.awaitingCommand) return;

    const actor =
      state.party.find((m) => m.id === bs.activeMemberId) ?? state.party[0];
    const result = reduceBattleUi(this.state.battle, intent, {
      actorId: actor.id,
      actorMp: actor.mp,
      knownSkills: classSkills(actor.classId),
      aliveEnemyIds: bs.enemies
        .filter((enemy) => enemy.hp > 0)
        .map((enemy) => enemy.id),
      usableItemIds: state.inventory
        .filter((entry) => isUsableBattleItem(entry.itemId))
        .map((entry) => entry.itemId),
    });

    switch (result.effect?.type) {
      case "defend":
        this.store.dispatch({ type: "BattleDefend" });
        break;
      case "flee":
        this.store.dispatch({ type: "BattleFlee" });
        break;
      case "attack":
        this.store.dispatch({
          type: "BattleAttack",
          targetId: result.effect.targetId,
        });
        break;
      case "skill":
        this.store.dispatch({
          type: "BattleSkill",
          skillId: result.effect.skillId,
          targetId: result.effect.targetId,
        });
        break;
      case "item":
        this.store.dispatch({
          type: "BattleItem",
          itemId: result.effect.itemId,
          targetId: result.effect.targetId,
        });
        break;
      default:
        break;
    }
    this.state = { ...this.state, battle: result.state };
  }

  private handleVillage(key: KeyName): void {
    switch (this.state.village.building) {
      case null:
        this.handleVillageOverview(key);
        break;
      case "inn":
        this.handleInn(key);
        break;
      case "church":
        this.handleChurch(key);
        break;
      case "store":
        this.handleStore(key);
        break;
      case "tavern":
        this.handleTavern(key);
        break;
    }
  }

  private backToOverview(reset: Partial<VillageFocusState> = {}): void {
    this.state = {
      ...this.state,
      village: { ...this.state.village, ...reset, building: null },
    };
  }

  private handleVillageOverview(key: KeyName): void {
    const intent = resolveOverviewIntent(key);
    if (!intent) return;
    const result = reduceOverviewUi(this.state.village.overview, intent);
    if (result.effect?.type === "enter") {
      this.state = {
        ...this.state,
        village: {
          ...this.state.village,
          building: result.effect.building,
          overview: result.state,
        },
      };

      if (
        result.effect.building === "tavern" &&
        this.store.getState().recruits.length === 0
      ) {
        this.store.dispatch({ type: "RefreshRecruits" });
      }
      if (
        result.effect.building === "store" &&
        this.store.getState().shopStock.length === 0
      ) {
        this.store.dispatch({ type: "RefreshShopStock" });
      }
      return;
    }
    if (result.effect?.type === "leave") {
      this.store.dispatch({ type: "ChangeScene", scene: "overworld" });
    }
    this.state = {
      ...this.state,
      village: { ...this.state.village, overview: result.state },
    };
  }

  private handleInn(key: KeyName): void {
    const intent = resolveInnIntent(key);
    if (!intent) return;
    const effect = reduceInnUi(intent);
    if (effect?.type === "rest") this.store.dispatch({ type: "InnHeal" });
    else if (effect?.type === "back") this.backToOverview();
  }

  private handleChurch(key: KeyName): void {
    const intent = resolveChurchIntent(key);
    if (!intent) return;
    const effect = reduceChurchUi(intent);
    if (effect?.type === "save") {
      const state = this.store.getState();
      saveGame(state)
        .then(() => {
          this.onSaved?.();
          this.store.dispatch({ type: "Log", message: "Game saved" });
        })
        .catch(() => {
          this.store.dispatch({
            type: "Log",
            message: "Failed to save game",
          });
        });
    } else if (effect?.type === "back") {
      this.backToOverview();
    }
  }

  private handleStore(key: KeyName): void {
    const storeUi = this.state.village.store;
    const intent = resolveStoreIntent(storeUi.mode, key);
    if (!intent) return;

    const state = this.store.getState();
    const clampedMemberIndex = Math.min(
      storeUi.memberIndex,
      state.party.length - 1,
    );
    const member = state.party[clampedMemberIndex];
    const highestLevel = Math.max(...state.party.map((p) => p.level));
    const result = reduceStoreUi(storeUi, intent, {
      partyLength: state.party.length,
      memberId: member.id,
      packEntries: buildPackEntries(member, state.items),
      shopRows: buildShopRows(highestLevel, state.shopStock),
    });

    if (result.effect?.type === "back") {
      this.backToOverview({ store: INITIAL_STORE_UI_STATE });
      return;
    }
    switch (result.effect?.type) {
      case "storeBuy":
        this.store.dispatch({
          type: "StoreBuy",
          itemId: result.effect.itemId,
          quantity: 1,
        });
        break;
      case "storeBuyRolled":
        this.store.dispatch({
          type: "StoreBuyRolled",
          instanceId: result.effect.instanceId,
        });
        break;
      case "storeSell":
        this.store.dispatch({
          type: "StoreSell",
          itemId: result.effect.itemId,
          quantity: 1,
        });
        break;
      case "sellItem":
        this.store.dispatch({
          type: "SellItem",
          instanceId: result.effect.instanceId,
        });
        break;
      default:
        break;
    }
    this.state = {
      ...this.state,
      village: { ...this.state.village, store: result.state },
    };
  }

  private handleTavern(key: KeyName): void {
    const tavernUi = this.state.village.tavern;
    const intent = resolveTavernIntent(
      tavernUi.mode,
      tavernUi.confirmId !== null,
      key,
    );
    if (!intent) return;

    const state = this.store.getState();
    const result = reduceTavernUi(tavernUi, intent, {
      recruitsLength: state.recruits.length,
      partyMemberIds: state.party.map((member) => member.id),
    });

    if (result.effect?.type === "back") {
      this.backToOverview({ tavern: INITIAL_TAVERN_UI_STATE });
      return;
    }
    switch (result.effect?.type) {
      case "hire":
        this.store.dispatch({
          type: "HireRecruit",
          index: result.effect.index,
        });
        break;
      case "dismiss":
        this.store.dispatch({
          type: "DismissMember",
          memberId: result.effect.memberId,
        });
        break;
      default:
        break;
    }
    this.state = {
      ...this.state,
      village: { ...this.state.village, tavern: result.state },
    };
  }
}

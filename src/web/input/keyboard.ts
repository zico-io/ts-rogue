/**
 * Browser focus-stack keyboard manager (ROG-45). Wires the DOM `keydown`
 * event to the exact same renderer-agnostic `Keymap`/`resolveXIntent`/
 * `reduceXUi` modules the Ink terminal renderer uses under
 * `src/ui/screens/**` and `src/ui/scene/globalInput` - no keymap or reducer
 * logic is duplicated here, only wiring: normalize the browser key,
 * resolve/reduce against whichever scene (and, for the village, sub-view)
 * currently has focus, apply the effect as a `store.dispatch`, and persist
 * any local UI state (cursor position, mode, etc.) for the next key press.
 *
 * Real per-scene rendering (and therefore visible focus) lands in ROG-49
 * through ROG-52; this module's state is real and drives key resolution
 * correctly today even though nothing on screen reflects it yet.
 */

import { isBattleHealItem } from "../../engine/combat/resolution";
import { classSkills } from "../../engine/combat/skills";
import type { GameStore } from "../../engine/state/store";
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
  type BrowserKeyEvent,
  normalizeBrowserKey,
} from "./normalizeBrowserKey";

/** The village's own internal focus: which building/sub-view owns input. */
export interface VillageFocusState {
  building: VillageBuilding | null;
  overview: OverviewUiState;
  store: StoreUiState;
  tavern: TavernUiState;
}

/** The whole focus stack's state: one slot per scene, plus the village's sub-view. */
export interface KeyboardManagerState {
  overworld: OverworldUiState;
  dungeon: DungeonUiState;
  battle: BattleUiState;
  village: VillageFocusState;
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
  };
}

/**
 * Owns the browser focus stack and routes normalized key presses to the
 * scene (and village sub-view) currently in focus. `handleKeyDown` is the
 * only entry point `main.ts` needs; `getState` exists for tests and future
 * rendering to read the current focus without re-deriving it.
 */
export class BrowserKeyboardManager {
  private state: KeyboardManagerState = createInitialKeyboardManagerState();

  constructor(
    private readonly store: GameStore,
    /** Fired on the quit key while playing (ROG-52 wires this to the browser's title flow). */
    private readonly onQuit: () => void,
  ) {}

  getState(): KeyboardManagerState {
    return this.state;
  }

  handleKeyDown(event: BrowserKeyEvent): void {
    const keyName = normalizeBrowserKey(event);
    if (!keyName) return;

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
        // TODO(ROG-48): browser dev console. Stashed, matching main.ts's
        // `--dev` flag stash, until that console exists.
        console.info(
          "ts-rogue: dev-console toggle key pressed (no browser dev console yet)",
        );
        break;
      case "quit":
        this.onQuit();
        break;
      default:
        break;
    }
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
    const intent = resolveDungeonIntent(key);
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
      healItemIds: state.inventory
        .filter((entry) => isBattleHealItem(entry.itemId))
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

  /** Returns to the village overview, resetting the sub-view that just lost focus. */
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
      // The recruit pool is empty on an old save (or after hiring everyone);
      // roll a fresh one on entry so the tavern is never bare, mirroring
      // `TavernView.tsx`'s on-mount effect (there is no mount hook here, so
      // the transition into the building is the equivalent moment).
      if (
        result.effect.building === "tavern" &&
        this.store.getState().recruits.length === 0
      ) {
        this.store.dispatch({ type: "RefreshRecruits" });
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
      // TODO(ROG-46): browser (IndexedDB) persistence. Stashed, matching
      // main.ts's `?fresh` no-op, until that persistence layer exists.
      console.info(
        "ts-rogue: church save key pressed (no browser persistence yet)",
      );
      this.store.dispatch({
        type: "Log",
        message: "Saving isn't available in the browser yet",
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
    const result = reduceStoreUi(storeUi, intent, {
      partyLength: state.party.length,
      memberId: member.id,
      packEntries: buildPackEntries(member, state.items),
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
      case "equip":
        this.store.dispatch({
          type: "EquipItem",
          instanceId: result.effect.instanceId,
          memberId: result.effect.memberId,
        });
        break;
      case "unequip":
        this.store.dispatch({
          type: "UnequipItem",
          slot: result.effect.slot,
          memberId: result.effect.memberId,
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

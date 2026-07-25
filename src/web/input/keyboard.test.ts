import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { startBattle } from "../../engine/combat/resolution";
import { Rng } from "../../engine/rng/rng";
import { GameStore, newGame, reduce } from "../../engine/state/store";
import type { GameState } from "../../engine/state/types";
import {
  generateOverworldMap,
  isPassable,
  tileAt,
} from "../../engine/world/overworld";
import { BrowserKeyboardManager } from "./keyboard";

function key(k: string) {
  return { key: k, ctrlKey: false, metaKey: false };
}

function storeAt(
  scene: GameState["scene"],
  overrides: Partial<GameState> = {},
) {
  const base = newGame(1);
  return new GameStore({ ...base, scene, ...overrides });
}

/** A real store with an active dungeon (floor 1 of entrance 0), for evac tests. */
function dungeonStore(): GameStore {
  const seed = 1;
  const map = generateOverworldMap(seed);
  const entrance = map.dungeonEntrances[0];
  const deltas: Array<{ dx: -1 | 0 | 1; dy: -1 | 0 | 1 }> = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];
  for (const { dx, dy } of deltas) {
    const from = { x: entrance.x - dx, y: entrance.y - dy };
    if (
      from.x < 0 ||
      from.x >= map.width ||
      from.y < 0 ||
      from.y >= map.height
    ) {
      continue;
    }
    if (!isPassable(tileAt(map, from))) continue;
    const before: GameState = {
      ...newGame(seed),
      scene: "overworld",
      worldState: { player: from, encounterMeter: 0 },
    };
    const entered = reduce(before, { type: "MoveOverworld", dx, dy });
    if (entered.scene === "dungeon") return new GameStore(entered);
  }
  throw new Error("no passable approach found for dungeon entrance 0");
}

describe("BrowserKeyboardManager - global bindings", () => {
  it("digit keys change the scene from anywhere", () => {
    const store = storeAt("village");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("2"));
    expect(store.getState().scene).toBe("overworld");

    manager.handleKeyDown(key("3"));
    expect(store.getState().scene).toBe("dungeon");
  });

  it("the dev-console toggle key is stashed, not dispatched", () => {
    const store = storeAt("village");
    const manager = new BrowserKeyboardManager(store, () => {});
    const before = store.getState();

    manager.handleKeyDown(key("`"));

    expect(store.getState()).toBe(before);
  });

  it("the quit key fires onQuit instead of dispatching to the store", () => {
    const store = storeAt("village");
    const before = store.getState();
    let quit = false;
    const manager = new BrowserKeyboardManager(store, () => {
      quit = true;
    });

    manager.handleKeyDown(key("q"));

    expect(quit).toBe(true);
    expect(store.getState()).toBe(before);
  });

  it("ctrl+c also fires onQuit", () => {
    const store = storeAt("village");
    let quit = false;
    const manager = new BrowserKeyboardManager(store, () => {
      quit = true;
    });

    manager.handleKeyDown({ key: "c", ctrlKey: true, metaKey: false });

    expect(quit).toBe(true);
  });
});

describe("BrowserKeyboardManager - overworld", () => {
  it("arrow keys dispatch MoveOverworld", () => {
    const store = storeAt("overworld");
    const manager = new BrowserKeyboardManager(store, () => {});
    const before = store.getState().worldState.player;

    manager.handleKeyDown(key("ArrowRight"));

    const after = store.getState().worldState.player;
    expect(after).not.toEqual(before);
  });

  it("Escape returns to the village", () => {
    const store = storeAt("overworld");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("Escape"));

    expect(store.getState().scene).toBe("village");
  });
});

describe("BrowserKeyboardManager - dungeon", () => {
  it("is a no-op with no active dungeon (reducer guards missing dungeonState)", () => {
    const store = storeAt("dungeon");
    const manager = new BrowserKeyboardManager(store, () => {});
    const before = store.getState();

    manager.handleKeyDown(key("ArrowUp"));

    expect(store.getState()).toBe(before);
  });

  it("< opens an evac confirm prompt instead of exiting immediately, y confirms it", () => {
    const store = dungeonStore();
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("<"));
    expect(store.getState().scene).toBe("dungeon");
    expect(manager.getState().dungeon.confirmingExit).toBe(true);

    manager.handleKeyDown(key("y"));
    expect(store.getState().scene).toBe("overworld");
    expect(manager.getState().dungeon.confirmingExit).toBeUndefined();
  });

  it("< then n cancels the evac confirm prompt without exiting", () => {
    const store = dungeonStore();
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("<"));
    manager.handleKeyDown(key("n"));

    expect(store.getState().scene).toBe("dungeon");
    expect(manager.getState().dungeon.confirmingExit).toBeUndefined();
  });
});

describe("BrowserKeyboardManager - Zoom fast travel (ENG-1)", () => {
  it("z opens the picker from the overworld, Enter travels to the highlighted waypoint, then closes", () => {
    const store = storeAt("overworld");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("z"));
    expect(manager.getState().zoom.open).toBe(true);

    manager.handleKeyDown(key("Enter"));
    expect(manager.getState().zoom.open).toBe(false);
    expect(store.getState().scene).toBe("village");
  });

  it("z is ignored from the dungeon (evac first)", () => {
    const store = storeAt("dungeon");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("z"));

    expect(manager.getState().zoom.open).toBe(false);
  });

  it("Escape closes the picker without dispatching Zoom", () => {
    const store = storeAt("overworld");
    const manager = new BrowserKeyboardManager(store, () => {});
    manager.handleKeyDown(key("z"));
    const before = store.getState();

    manager.handleKeyDown(key("Escape"));

    expect(manager.getState().zoom.open).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it("digits don't leak through to change scene while the picker is open", () => {
    const store = storeAt("overworld");
    const manager = new BrowserKeyboardManager(store, () => {});
    manager.handleKeyDown(key("z"));

    manager.handleKeyDown(key("1"));

    expect(store.getState().scene).toBe("overworld");
    expect(manager.getState().zoom.open).toBe(true);
  });
});

describe("BrowserKeyboardManager - battle", () => {
  function battleStore() {
    const base = newGame(1);
    const rng = new Rng(base.seed, base.rngState);
    const battle = startBattle(rng, base.party, "wandering", 1, "overworld");
    const state: GameState = {
      ...base,
      scene: "battle",
      rngState: rng.getState(),
      battleState: battle,
    };
    return new GameStore(state);
  }

  it("Down cycles the action cursor without dispatching an engine event", () => {
    const store = battleStore();
    const manager = new BrowserKeyboardManager(store, () => {});
    const before = store.getState();

    manager.handleKeyDown(key("ArrowDown"));

    expect(store.getState()).toBe(before);
    expect(manager.getState().battle.actionCursor).toBe(1);
  });

  it("Enter on Attack (cursor 0) moves to target mode; Enter again dispatches BattleAttack", () => {
    const store = battleStore();
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("Enter"));
    expect(manager.getState().battle.mode).toBe("target");

    manager.handleKeyDown(key("Enter"));
    // The round resolved: either the battle continues (back to action mode)
    // or it ended and the scene changed away from battle.
    const state = store.getState();
    if (state.scene === "battle") {
      expect(manager.getState().battle.mode).toBe("action");
    } else {
      expect(state.scene).not.toBe("battle");
    }
  });

  it("is a no-op when there is no battleState", () => {
    const store = storeAt("battle");
    const manager = new BrowserKeyboardManager(store, () => {});
    const before = store.getState();

    manager.handleKeyDown(key("Enter"));

    expect(store.getState()).toBe(before);
  });
});

describe("BrowserKeyboardManager - village focus stack", () => {
  it("i opens the Inn from the overview, Enter rests, Escape returns", () => {
    const store = storeAt("village");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("i"));
    expect(manager.getState().village.building).toBe("inn");

    const goldBefore = store.getState().gold;
    manager.handleKeyDown(key("Enter"));
    expect(store.getState().gold).not.toBe(goldBefore);

    manager.handleKeyDown(key("Escape"));
    expect(manager.getState().village.building).toBeNull();
  });

  it("o from the overview leaves to the overworld", () => {
    const store = storeAt("village");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("o"));

    expect(store.getState().scene).toBe("overworld");
  });

  it("Store: Tab flips shop/pack, and pack-mode keys change based on the flipped mode", () => {
    const store = storeAt("village");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("s"));
    expect(manager.getState().village.building).toBe("store");
    expect(manager.getState().village.store.mode).toBe("shop");

    manager.handleKeyDown(key("Tab"));
    expect(manager.getState().village.store.mode).toBe("pack");

    // "b" (buy) only means something in shop mode; in pack mode it's unbound.
    const before = store.getState();
    manager.handleKeyDown(key("b"));
    expect(store.getState()).toBe(before);

    manager.handleKeyDown(key("Escape"));
    expect(manager.getState().village.building).toBeNull();
    // Leaving resets the store's local state for the next visit.
    expect(manager.getState().village.store.mode).toBe("shop");
  });

  it("Tavern: h hires the selected recruit (literal h, not char:h)", () => {
    const store = storeAt("village");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("t"));
    expect(manager.getState().village.building).toBe("tavern");
    expect(store.getState().recruits.length).toBeGreaterThan(0);

    const partyBefore = store.getState().party.length;
    manager.handleKeyDown(key("h"));
    expect(store.getState().party.length).toBe(partyBefore + 1);
  });

  it("Tavern: d on the hero (index 0) never opens a dismiss confirmation", () => {
    const store = storeAt("village");
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("t"));
    manager.handleKeyDown(key("Tab"));
    expect(manager.getState().village.tavern.mode).toBe("party");

    manager.handleKeyDown(key("d"));
    expect(manager.getState().village.tavern.confirmId).toBeNull();
  });

  it("Tavern: entering with an empty recruit pool refreshes it once", () => {
    const store = storeAt("village", { recruits: [] });
    const manager = new BrowserKeyboardManager(store, () => {});

    manager.handleKeyDown(key("t"));

    expect(store.getState().recruits.length).toBeGreaterThan(0);
  });

  it("Church: Enter saves to the browser save slot and logs the result", async () => {
    const store = storeAt("village");
    let saved = false;
    const manager = new BrowserKeyboardManager(
      store,
      () => {},
      () => {
        saved = true;
      },
    );

    manager.handleKeyDown(key("c"));
    expect(manager.getState().village.building).toBe("church");

    manager.handleKeyDown(key("Enter"));
    // The save write is async (IndexedDB); wait for it to settle before
    // asserting on its side effects.
    await vi.waitFor(() => expect(saved).toBe(true));
    expect(store.getState().log.at(-1)?.text).toBe("Game saved");
  });
});

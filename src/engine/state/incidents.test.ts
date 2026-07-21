import { describe, expect, it } from "vitest";
import type { ItemInstance } from "../loot/types";
import {
  incidentFingerprint,
  StateInvariantError,
  validateGameState,
} from "./incidents";
import { GameStore, newGame } from "./store";

describe("state incident boundary", () => {
  it("accepts a valid state and rejects broken required/economy/HP/inventory fields", () => {
    expect(() => validateGameState(newGame(1))).not.toThrow();
    const invalid = [
      { ...newGame(1), gold: -1 },
      { ...newGame(1), party: [] },
      { ...newGame(1), inventory: [{ itemId: "potion", quantity: 0 }] },
      {
        ...newGame(1),
        party: [{ ...newGame(1).party[0], hp: newGame(1).party[0].maxHp + 1 }],
      },
    ];
    for (const state of invalid) {
      expect(() => validateGameState(state)).toThrow(StateInvariantError);
    }
  });

  it("rejects duplicate item instance IDs across backpack and equipment", () => {
    const state = newGame(1);
    const item: ItemInstance = {
      instanceId: "item-1",
      baseId: "rusty-sword",
      rarity: "common",
      ilvl: 1,
      prefixes: [],
      suffixes: [],
      implicit: null,
    };
    state.items = [item];
    state.party[0].equipment.weapon = item;
    expect(() => validateGameState(state)).toThrow("item instance IDs");
  });

  it("keeps the last valid state and raises an incident for an invalid reducer result", () => {
    const store = new GameStore(newGame(1));
    const before = store.getState();
    const incidents: string[] = [];
    store.subscribeIncidents((incident) => incidents.push(incident.category));
    store.dispatch({
      type: "Log",
      message: 1n as unknown as string,
    });
    expect(store.getState()).toBe(before);
    expect(incidents).toEqual(["invariant"]);
    expect(store.getDebugJournal().at(-1)?.kind).toBe("invariant");
  });

  it("captures reducer exceptions without advancing state", () => {
    const store = new GameStore(newGame(1));
    const before = store.getState();
    let incidentCategory = "";
    store.subscribeIncidents((incident) => {
      incidentCategory = incident.category;
    });
    const event = {
      type: "StoreBuy" as const,
      get itemId(): string {
        throw new Error("synthetic reducer failure");
      },
      quantity: 1,
    };
    store.dispatch(event);
    expect(store.getState()).toBe(before);
    expect(incidentCategory).toBe("reducer");
  });

  it("bounds the debug journal at 200 compact dispatch entries", () => {
    const store = new GameStore(newGame(1));
    for (let index = 0; index < 205; index += 1) {
      store.dispatch({ type: "Log", message: String(index) });
    }
    expect(store.getDebugJournal()).toHaveLength(200);
    expect(store.getDebugJournal()[0].event).toBe("Log");
    expect(store.getDebugJournal()[0].before?.scene).toBe("village");
  });

  it("journals recoverable lifecycle failures without changing state", () => {
    const store = new GameStore(newGame(1));
    const before = store.getState();
    store.reportFailure("save", new Error("disk full"), false);
    expect(store.getState()).toBe(before);
    expect(store.getDebugJournal().at(-1)).toMatchObject({
      kind: "failure",
      message: "disk full",
    });
  });

  it("creates a stable fingerprint and changes it with the category", () => {
    const error = new Error("  Broken   state ");
    error.stack = "Error: Broken state\n    at reduce (store.ts:1:1)";
    expect(incidentFingerprint("reducer", error)).toBe(
      incidentFingerprint("reducer", error),
    );
    expect(incidentFingerprint("reducer", error)).not.toBe(
      incidentFingerprint("render", error),
    );
  });
});

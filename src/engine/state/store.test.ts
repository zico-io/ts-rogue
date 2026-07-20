import { describe, expect, it } from "vitest";
import { GameStore, newGame, reduce } from "./store.js";
import { MAX_MESSAGES } from "./types.js";

describe("game store", () => {
  it("changes scene without mutating the previous state", () => {
    const before = newGame(1);
    const after = reduce(before, { type: "ChangeScene", scene: "overworld" });
    expect(after.scene).toBe("overworld");
    expect(before.scene).toBe("village");
    expect(after).not.toBe(before);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const store = new GameStore(newGame(1));
    const scenes: string[] = [];
    const unsubscribe = store.subscribe((s) => scenes.push(s.scene));
    store.dispatch({ type: "ChangeScene", scene: "dungeon" });
    unsubscribe();
    store.dispatch({ type: "ChangeScene", scene: "battle" });
    expect(store.getState().scene).toBe("battle");
    expect(scenes).toEqual(["dungeon"]);
  });

  it("produces an identical state (including the log) for the same seed", () => {
    const a = newGame(2024);
    const b = newGame(2024);
    expect(a).toEqual(b);
  });

  it("logs the seed when starting a new game", () => {
    const state = newGame(42);
    expect(state.messages).toEqual(["Started new game with seed 42"]);
  });

  it("appends to the log on scene changes and caps it at MAX_MESSAGES", () => {
    let state = newGame(1);
    for (let i = 0; i < MAX_MESSAGES + 10; i++) {
      state = reduce(state, { type: "ChangeScene", scene: "dungeon" });
    }
    expect(state.messages.length).toBe(MAX_MESSAGES);
    expect(state.messages.at(-1)).toBe("Entered dungeon");
  });
});

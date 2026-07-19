import { describe, expect, it } from "vitest";
import { GameStore, newGame, reduce } from "./store.js";

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
});

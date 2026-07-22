import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { newGame, reduce } from "../engine/state/store";
import type { GameState } from "../engine/state/types";
import { createInitialDungeonState } from "../engine/world/dungeon";
import { clearSave, loadGame, saveGame } from "./browserSave";
import { IndexedDbSaveStorage } from "./indexedDbStorage";

describe("browser save round-trip (IndexedDB)", () => {
  it("returns undefined when no save exists yet", async () => {
    const storage = new IndexedDbSaveStorage("ts-rogue-test-empty");
    await expect(loadGame(storage)).resolves.toBeUndefined();
  });

  it("round-trips a full GameState including party/gold/inventory", async () => {
    const storage = new IndexedDbSaveStorage("ts-rogue-test-roundtrip");
    const state = reduce(
      reduce(newGame(42), { type: "StoreBuy", itemId: "potion", quantity: 3 }),
      { type: "Log", message: "on the road" },
    );

    await saveGame(state, storage);
    const loaded = await loadGame(storage);

    expect(loaded).toEqual(state);
  });

  it("round-trips a full GameState including an active dungeonState", async () => {
    const storage = new IndexedDbSaveStorage("ts-rogue-test-dungeon");
    const entered: GameState = {
      ...newGame(42),
      scene: "dungeon",
      dungeonState: createInitialDungeonState(42, "dungeon-0", 1),
    };
    const moved = reduce(entered, { type: "TurnDungeon", direction: "right" });

    await saveGame(moved, storage);
    const loaded = await loadGame(storage);

    expect(loaded).toEqual(moved);
    expect(loaded?.dungeonState?.facing).toBe("east");
  });

  it("clearSave empties the slot", async () => {
    const storage = new IndexedDbSaveStorage("ts-rogue-test-clear");
    await saveGame(newGame(7), storage);
    await expect(loadGame(storage)).resolves.not.toBeUndefined();

    await clearSave(storage);
    await expect(loadGame(storage)).resolves.toBeUndefined();
  });
});

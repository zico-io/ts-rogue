import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newGame, reduce } from "../engine/state/store.js";
import { deserialize, loadGame, saveGame, serialize } from "./save.js";

describe("save round-trip (JSON)", () => {
  it("restores an equivalent state", () => {
    const state = newGame(9001);
    expect(deserialize(serialize(state))).toEqual(state);
  });
});

describe("save round-trip (sqlite)", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tempDbPath(): string {
    dir = mkdtempSync(join(tmpdir(), "ts-rogue-save-"));
    return join(dir, "save.db");
  }

  it("returns undefined when no save exists yet", () => {
    const dbPath = tempDbPath();
    expect(loadGame(dbPath)).toBeUndefined();
  });

  it("round-trips a full GameState including party/gold/inventory", () => {
    const dbPath = tempDbPath();
    const state = reduce(
      reduce(newGame(42), { type: "StoreBuy", itemId: "potion", quantity: 3 }),
      { type: "Log", message: "on the road" },
    );

    saveGame(state, dbPath);
    const loaded = loadGame(dbPath);

    expect(loaded).toEqual(state);
  });

  it("upserts on repeated saves so the second save's state wins", () => {
    const dbPath = tempDbPath();
    const first = newGame(1);
    const second = reduce(first, { type: "ChangeScene", scene: "overworld" });

    saveGame(first, dbPath);
    saveGame(second, dbPath);

    expect(loadGame(dbPath)).toEqual(second);
  });
});

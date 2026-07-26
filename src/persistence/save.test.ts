import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ItemInstance } from "../engine/loot/types";
import { newGame, reduce } from "../engine/state/store";
import type { GameState } from "../engine/state/types";
import { createInitialDungeonState } from "../engine/world/dungeon";
import { deserialize, loadGame, saveGame, serialize } from "./save";

describe("save round-trip (JSON)", () => {
  it("restores an equivalent state", () => {
    const state = newGame(9001);
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it("round-trips a GameState with an active dungeonState (layout, explored, facing)", () => {
    const entered: GameState = {
      ...newGame(42),
      scene: "dungeon",
      dungeonState: createInitialDungeonState(42, "dungeon-0", 1),
    };
    const moved = reduce(entered, { type: "TurnDungeon", direction: "right" });
    expect(deserialize(serialize(moved))).toEqual(moved);
    expect(deserialize(serialize(moved)).dungeonState?.facing).toBe("east");
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

  it("round-trips a full GameState including an active dungeonState", () => {
    const dbPath = tempDbPath();
    const entered: GameState = {
      ...newGame(42),
      scene: "dungeon",
      dungeonState: createInitialDungeonState(42, "dungeon-0", 2),
    };
    const state = reduce(
      reduce(entered, { type: "StepDungeon", direction: "forward" }),
      { type: "TurnDungeon", direction: "left" },
    );
    saveGame(state, dbPath);
    const loaded = loadGame(dbPath);
    expect(loaded).toEqual(state);
    expect(loaded?.dungeonState).not.toBeNull();
    expect(loaded?.dungeonState?.floor).toBe(2);
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

describe("save round-trip with loot and equipment", () => {
  const item: ItemInstance = {
    instanceId: "itm-1",
    baseId: "guardian-bulwark",
    rarity: "unique",
    ilvl: 12,
    prefixes: [{ affixId: "vicious", value: 5 }],
    suffixes: [{ affixId: "of-might", value: 2 }],
    implicit: { affixId: "sig-warding", value: 9 },
  };

  it("JSON round-trips a state with backpack items and an equipped item", () => {
    const base = newGame(42);
    const state: GameState = {
      ...base,
      items: [item],
      nextItemId: 2,
      party: [
        {
          ...base.party[0],
          equipment: { ...base.party[0].equipment, armor: item },
        },
      ],
    };
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it("sqlite round-trips a state with backpack items and an equipped item", () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-rogue-loot-"));
    const dbPath = join(dir, "save.db");
    try {
      const base = newGame(7);
      const weapon: ItemInstance = {
        ...item,
        instanceId: "itm-2",
        baseId: "guardian-greatsword",
      };
      const state: GameState = {
        ...base,
        items: [item],
        nextItemId: 3,
        party: [
          {
            ...base.party[0],
            equipment: { ...base.party[0].equipment, weapon },
          },
        ],
      };
      saveGame(state, dbPath);
      const loaded = loadGame(dbPath);
      expect(loaded).toEqual(state);
      expect(loaded?.items[0].implicit?.affixId).toBe("sig-warding");
      expect(loaded?.party[0].equipment.weapon?.baseId).toBe(
        "guardian-greatsword",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("deserialize backfills classId for older saves (ROG-17)", () => {
  it("defaults a party member without classId to warrior", () => {
    const modern = newGame(42);

    const older = {
      ...modern,
      party: [{ ...modern.party[0], classId: undefined }],
    };
    const restored = deserialize(JSON.stringify(older));
    expect(restored.party[0].classId).toBe("warrior");
  });

  it("preserves an explicit classId through a round-trip", () => {
    const state = newGame(42, { classId: "wizard" });
    const restored = deserialize(serialize(state));
    expect(restored.party[0].classId).toBe("wizard");
  });
});

describe("deserialize upgrades plain-string log lines (pre-ROG-31)", () => {
  it("wraps legacy strings as system entries and keeps typed entries", () => {
    const modern = newGame(42);
    const older = { ...modern, log: ["old line", modern.log[0]] };
    const restored = deserialize(JSON.stringify(older));
    expect(restored.log).toEqual([
      { text: "old line", kind: "system" },
      { text: "Started new game with seed 42", kind: "quest" },
    ]);
  });
});

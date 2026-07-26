import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  type GameSettings,
  loadSettings,
  saveSettings,
} from "./settings";

describe("settings persistence", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tempDbPath(): string {
    dir = mkdtempSync(join(tmpdir(), "ts-rogue-settings-"));
    return join(dir, "save.db");
  }

  it("returns defaults when no settings row exists yet", () => {
    expect(loadSettings(tempDbPath())).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips saved settings", () => {
    const dbPath = tempDbPath();
    const settings: GameSettings = {
      defaultPermadeath: true,
      defaultHeroName: "Aria",
      customSeed: 12345,
    };
    saveSettings(settings, dbPath);
    expect(loadSettings(dbPath)).toEqual(settings);
  });

  it("upserts so the latest write wins", () => {
    const dbPath = tempDbPath();
    saveSettings({ ...DEFAULT_SETTINGS, customSeed: 1 }, dbPath);
    saveSettings({ ...DEFAULT_SETTINGS, customSeed: 2 }, dbPath);
    expect(loadSettings(dbPath).customSeed).toBe(2);
  });

  it("backfills missing keys from defaults for a partial row", () => {
    const dbPath = tempDbPath();

    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, settings_json TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO settings (id, settings_json) VALUES (1, ?)").run(
      JSON.stringify({ defaultHeroName: "Zed" }),
    );
    db.close();

    expect(loadSettings(dbPath)).toEqual({
      ...DEFAULT_SETTINGS,
      defaultHeroName: "Zed",
    });
  });
});

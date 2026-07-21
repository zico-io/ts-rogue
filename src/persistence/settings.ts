import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SAVE_PATH } from "./save";

/** Player preferences that outlive a single run (title-screen Settings menu). */
export interface GameSettings {
  /** New runs default to Permadeath when true. */
  defaultPermadeath: boolean;
  /** Name pre-filled in the New Game name step. */
  defaultHeroName: string;
  /** Fixed run seed for reproducible games; null uses the clock/boot seed. */
  customSeed: number | null;
}

export const DEFAULT_SETTINGS: GameSettings = {
  defaultPermadeath: false,
  defaultHeroName: "Hero",
  customSeed: null,
};

/** Single settings row (shares the save db file, separate table). */
const SETTINGS_ROW = 1;

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, settings_json TEXT NOT NULL)",
  );
  return db;
}

/**
 * Load saved settings, backfilling any missing key from `DEFAULT_SETTINGS` so
 * a settings row written by an older build never yields `undefined` fields.
 */
export function loadSettings(dbPath: string = DEFAULT_SAVE_PATH): GameSettings {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare("SELECT settings_json FROM settings WHERE id = ?")
      .get(SETTINGS_ROW) as { settings_json: string } | undefined;
    if (!row) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.settings_json) };
  } finally {
    db.close();
  }
}

/** Persist settings, upserting over the single row. */
export function saveSettings(
  settings: GameSettings,
  dbPath: string = DEFAULT_SAVE_PATH,
): void {
  const db = openDb(dbPath);
  try {
    db.prepare(
      `INSERT INTO settings (id, settings_json) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json`,
    ).run(SETTINGS_ROW, JSON.stringify(settings));
  } finally {
    db.close();
  }
}

import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SAVE_PATH } from "./save";

export interface GameSettings {
  defaultPermadeath: boolean;

  defaultHeroName: string;

  customSeed: number | null;
}

export const DEFAULT_SETTINGS: GameSettings = {
  defaultPermadeath: false,
  defaultHeroName: "Hero",
  customSeed: null,
};

const SETTINGS_ROW = 1;

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, settings_json TEXT NOT NULL)",
  );
  return db;
}

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

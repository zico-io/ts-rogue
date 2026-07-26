import type { GameState } from "../engine/state/types";
import { deserialize, serialize } from "./serializer";
import { clearSlot, readSlot, writeSlot } from "./sqliteStorage";

export { deserialize, serialize };

export const DEFAULT_SAVE_PATH = "./save.db";

export function saveGame(
  state: GameState,
  dbPath: string = DEFAULT_SAVE_PATH,
): void {
  writeSlot(dbPath, serialize(state));
}

export function loadGame(
  dbPath: string = DEFAULT_SAVE_PATH,
): GameState | undefined {
  const json = readSlot(dbPath);
  return json === undefined ? undefined : deserialize(json);
}

export function clearSave(dbPath: string = DEFAULT_SAVE_PATH): void {
  clearSlot(dbPath);
}

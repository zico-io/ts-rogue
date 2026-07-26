import type { GameState } from "../engine/state/types";
import { IndexedDbSaveStorage } from "./indexedDbStorage";
import { deserialize, serialize } from "./serializer";
import type { SaveStorage } from "./storage";

const defaultStorage = new IndexedDbSaveStorage();

export async function loadGame(
  storage: SaveStorage = defaultStorage,
): Promise<GameState | undefined> {
  const json = await storage.load();
  return json === undefined ? undefined : deserialize(json);
}

export async function saveGame(
  state: GameState,
  storage: SaveStorage = defaultStorage,
): Promise<void> {
  await storage.save(serialize(state));
}

export async function clearSave(
  storage: SaveStorage = defaultStorage,
): Promise<void> {
  await storage.clear();
}

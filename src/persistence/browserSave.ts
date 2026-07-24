import type { GameState } from "../engine/state/types";
import { IndexedDbSaveStorage } from "./indexedDbStorage";
import { deserialize, serialize } from "./serializer";
import type { SaveStorage } from "./storage";

const defaultStorage = new IndexedDbSaveStorage();

/**
 * Browser counterpart to `save.ts`'s sync sqlite functions (ROG-46). Async
 * because IndexedDB is inherently async, unlike `node:sqlite` - callers
 * (`src/web/main.ts`, `src/web/input/keyboard.ts`) await or `.then`/`.catch`
 * these instead of calling them inline. `storage` defaults to a single
 * shared `IndexedDbSaveStorage` so the browser app talks to one real
 * database; tests pass their own isolated instance.
 */
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

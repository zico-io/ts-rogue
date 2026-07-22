import type { GameState } from "../engine/state/types";
import { deserialize, serialize } from "./serializer";
import { clearSlot, readSlot, writeSlot } from "./sqliteStorage";

// Re-exported so existing imports (`import { serialize, deserialize } from
// "./save"`) keep working unchanged - the pure logic itself now lives in
// `serializer.ts`, shared with the browser's IndexedDB backend (ROG-46).
export { deserialize, serialize };

/** Default sqlite file for the single save slot. */
export const DEFAULT_SAVE_PATH = "./save.db";

/**
 * Write `state` to the single save slot, upserting over any prior save.
 * Sync API (kept from before ROG-46 split out the storage backend) - the
 * underlying `node:sqlite` calls are synchronous anyway, and every existing
 * caller (`app.tsx`, `ChurchView.tsx`, `save.test.ts`) depends on that.
 */
export function saveGame(
  state: GameState,
  dbPath: string = DEFAULT_SAVE_PATH,
): void {
  writeSlot(dbPath, serialize(state));
}

/** Load the single save slot, or `undefined` on a fresh boot with no save yet. */
export function loadGame(
  dbPath: string = DEFAULT_SAVE_PATH,
): GameState | undefined {
  const json = readSlot(dbPath);
  return json === undefined ? undefined : deserialize(json);
}

/**
 * Clear the single save slot (Phase 6, ROG-12). Called by the UI when a
 * permadeath run ends so the next boot starts a fresh run instead of loading
 * the dead game-over state. I/O lives here in the persistence layer, not the
 * engine; the engine only sets the `gameOver` flag.
 */
export function clearSave(dbPath: string = DEFAULT_SAVE_PATH): void {
  clearSlot(dbPath);
}

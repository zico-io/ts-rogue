/**
 * Storage backend interface (ROG-46): the single-save-slot persistence
 * contract shared by the terminal (`sqliteStorage.ts`'s `SqliteSaveStorage`,
 * over `node:sqlite`) and the browser (`indexedDbStorage.ts`'s
 * `IndexedDbSaveStorage`, over IndexedDB). Deals only in the already-
 * serialized JSON blob - `serializer.ts`'s `serialize`/`deserialize` sit
 * above this layer and are shared by both platforms, so the save *format*
 * stays portable even though the store itself is not.
 */
export interface SaveStorage {
  /** Read the single save slot's JSON blob, or `undefined` if it is empty. */
  load(): Promise<string | undefined>;
  /** Write `json` to the single save slot, upserting over any prior save. */
  save(json: string): Promise<void>;
  /** Delete the single save slot, if present. */
  clear(): Promise<void>;
}

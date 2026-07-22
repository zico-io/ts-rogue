import type { SaveStorage } from "./storage";

const STORE_NAME = "saves";
/** Single save slot, mirroring `sqliteStorage.ts`'s `SAVE_SLOT` convention. */
const SAVE_SLOT = 1;
const DEFAULT_DB_NAME = "ts-rogue-save";
const DB_VERSION = 1;

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Async `SaveStorage` (ROG-46) over the global `indexedDB` - the browser
 * counterpart to `sqliteStorage.ts`'s `SqliteSaveStorage`. Uses whatever
 * `indexedDB` global is in scope, so it works against a real browser's
 * implementation and, in tests, against `fake-indexeddb/auto`'s polyfill of
 * that same global - this module never imports `fake-indexeddb` itself.
 * One object store, one fixed key, matching the sqlite backend's
 * single-save-slot semantics.
 */
export class IndexedDbSaveStorage implements SaveStorage {
  constructor(private readonly dbName: string = DEFAULT_DB_NAME) {}

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load(): Promise<string | undefined> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const result = await promisifyRequest(
        tx.objectStore(STORE_NAME).get(SAVE_SLOT) as IDBRequest<
          string | undefined
        >,
      );
      return result;
    } finally {
      db.close();
    }
  }

  async save(json: string): Promise<void> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(json, SAVE_SLOT);
      await promisifyTransaction(tx);
    } finally {
      db.close();
    }
  }

  async clear(): Promise<void> {
    const db = await this.openDb();
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(SAVE_SLOT);
      await promisifyTransaction(tx);
    } finally {
      db.close();
    }
  }
}

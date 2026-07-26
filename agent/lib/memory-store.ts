import { type Client, createClient } from "@libsql/client";
import { mintMemoryDatabaseCredential } from "./memory";

/**
 * One fact in Eve's runtime memory store (HAR-71). This is deliberately
 * low-stakes, autonomously written operational memory - a debugging insight,
 * a workaround, an entity dedup note - not the reviewed shipped-behavior
 * source of truth that lives in `.botfile/memory/domain/product.md`.
 */
export interface Memory {
  key: string;
  value: string;
  /** e.g. "workaround", "entity", "debugging-note". */
  category: string;
  /** Provenance, matching `.botfile` discipline (who/what wrote this and why). */
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryStore {
  list(options: { category?: string; limit: number }): Promise<Memory[]>;
  put(memory: {
    key: string;
    value: string;
    category: string;
    source: string;
  }): Promise<Memory>;
  delete(key: string): Promise<boolean>;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS memories (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS memories_category_idx ON memories (category)",
];

interface MemoryRow {
  key: string;
  value: string;
  category: string;
  source: string;
  created_at: string;
  updated_at: string;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    key: row.key,
    value: row.value,
    category: row.category,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Produces a connected libSQL client. Called fresh for every store operation. */
export type MemoryClientFactory = () => Promise<Client> | Client;

/** Returns the current timestamp for a write. Overridable for deterministic tests. */
export type MemoryClock = () => string;

async function mintMemoryClient(): Promise<Client> {
  const credential = await mintMemoryDatabaseCredential();
  return createClient({ url: credential.url, authToken: credential.authToken });
}

/**
 * libSQL-backed `MemoryStore`. Single-tenant: the store belongs to the Eve
 * harness itself, not per-end-user, so no operation takes a tenant scope
 * (contrast eve's `patterns/multi-tenant-memory.md`).
 *
 * Every operation requests its own client and re-applies the (idempotent)
 * schema migration rather than holding one long-lived connection open:
 * `mintMemoryDatabaseCredential` mints a short-lived Connect token meant to
 * be requested fresh per use rather than cached across calls, and the
 * migration is cheap `CREATE ... IF NOT EXISTS` DDL.
 */
export class LibsqlMemoryStore implements MemoryStore {
  constructor(
    private readonly getClient: MemoryClientFactory = mintMemoryClient,
    private readonly now: MemoryClock = () => new Date().toISOString(),
  ) {}

  private async connect(): Promise<Client> {
    const client = await this.getClient();
    await client.batch(MIGRATIONS, "write");
    return client;
  }

  async list(options: { category?: string; limit: number }): Promise<Memory[]> {
    const client = await this.connect();
    const result = options.category
      ? await client.execute({
          sql: "SELECT * FROM memories WHERE category = ? ORDER BY updated_at DESC LIMIT ?",
          args: [options.category, options.limit],
        })
      : await client.execute({
          sql: "SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?",
          args: [options.limit],
        });
    return result.rows.map((row) => rowToMemory(row as unknown as MemoryRow));
  }

  async put(memory: {
    key: string;
    value: string;
    category: string;
    source: string;
  }): Promise<Memory> {
    const client = await this.connect();
    const now = this.now();
    await client.execute({
      sql: `INSERT INTO memories (key, value, category, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              category = excluded.category,
              source = excluded.source,
              updated_at = excluded.updated_at`,
      args: [memory.key, memory.value, memory.category, memory.source, now, now],
    });
    const result = await client.execute({
      sql: "SELECT * FROM memories WHERE key = ?",
      args: [memory.key],
    });
    const row = result.rows[0];
    if (!row) {
      throw new Error(`memory-store: failed to read back "${memory.key}" after put`);
    }
    return rowToMemory(row as unknown as MemoryRow);
  }

  async delete(key: string): Promise<boolean> {
    const client = await this.connect();
    const result = await client.execute({
      sql: "DELETE FROM memories WHERE key = ?",
      args: [key],
    });
    return result.rowsAffected > 0;
  }
}

/** Default store bound to Eve's runtime memory database (HAR-71/72). */
export const memoryStore: MemoryStore = new LibsqlMemoryStore();

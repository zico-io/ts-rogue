import { type Client, createClient, type Row } from "@libsql/client";
import { mintMemoryDatabaseCredential } from "./connector";

/** One low-stakes, autonomously written operational fact (HAR-71). */
export interface Memory {
  key: string;
  value: string;
  category: string;
  source: string;
  createdAt: string;
  updatedAt: string;
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

const DEFAULT_MAX_MEMORIES = 500;

function rowToMemory(row: Row): Memory {
  const { key, value, category, source, created_at, updated_at } = row;
  if (
    typeof key !== "string" ||
    typeof value !== "string" ||
    typeof category !== "string" ||
    typeof source !== "string" ||
    typeof created_at !== "string" ||
    typeof updated_at !== "string"
  ) {
    throw new Error("memory/store: expected all memories columns to be text");
  }
  return {
    key,
    value,
    category,
    source,
    createdAt: created_at,
    updatedAt: updated_at,
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

/** Single-tenant libSQL `MemoryStore`; every operation mints its own client. */
export class LibsqlMemoryStore {
  constructor(
    private readonly getClient: MemoryClientFactory = mintMemoryClient,
    private readonly now: MemoryClock = () => new Date().toISOString(),
    private readonly maxMemories: number = DEFAULT_MAX_MEMORIES,
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
    return result.rows.map(rowToMemory);
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
      args: [
        memory.key,
        memory.value,
        memory.category,
        memory.source,
        now,
        now,
      ],
    });
    await client.execute({
      sql: `DELETE FROM memories WHERE key NOT IN (
              SELECT key FROM memories ORDER BY updated_at DESC LIMIT ?
            )`,
      args: [this.maxMemories],
    });
    const result = await client.execute({
      sql: "SELECT * FROM memories WHERE key = ?",
      args: [memory.key],
    });
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `memory/store: failed to read back "${memory.key}" after put`,
      );
    }
    return rowToMemory(row);
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
export const memoryStore = new LibsqlMemoryStore();

/** What the tools need of a store, so a test can pass a fake one. */
export type MemoryStore = Pick<LibsqlMemoryStore, "list" | "put" | "delete">;

import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { LibsqlMemoryStore, type MemoryClock } from "./memory-store";

function createTestStore(now?: MemoryClock, maxMemories?: number): LibsqlMemoryStore {
  // A fresh in-memory database per store: `:memory:` state lives on this
  // one Client instance, so tests must reuse it across calls instead of
  // minting a new client per operation the way production does.
  const client = createClient({ url: ":memory:" });
  return new LibsqlMemoryStore(() => client, now, maxMemories);
}

function tickingClock(startYear = 2026): MemoryClock {
  let tick = 0;
  return () => new Date(startYear, 0, 1, 0, 0, tick++).toISOString();
}

describe("LibsqlMemoryStore", () => {
  it("returns an empty list before any writes", async () => {
    const store = createTestStore();
    await expect(store.list({ limit: 10 })).resolves.toEqual([]);
  });

  it("round-trips a put through list", async () => {
    const store = createTestStore(tickingClock());
    const written = await store.put({
      key: "workaround.eve-sandbox-flake",
      value: "Retried sandbox creation twice before it stabilized.",
      category: "workaround",
      source: "HAR-73 session, 2026-07-27",
    });

    expect(written).toEqual({
      key: "workaround.eve-sandbox-flake",
      value: "Retried sandbox creation twice before it stabilized.",
      category: "workaround",
      source: "HAR-73 session, 2026-07-27",
      createdAt: written.createdAt,
      updatedAt: written.createdAt,
    });

    await expect(store.list({ limit: 10 })).resolves.toEqual([written]);
  });

  it("filters list results by category", async () => {
    const store = createTestStore(tickingClock());
    await store.put({ key: "a", value: "1", category: "workaround", source: "test" });
    await store.put({ key: "b", value: "2", category: "entity", source: "test" });

    const workaroundsOnly = await store.list({ category: "workaround", limit: 10 });
    expect(workaroundsOnly.map((memory) => memory.key)).toEqual(["a"]);
  });

  it("respects the list limit", async () => {
    const store = createTestStore(tickingClock());
    await store.put({ key: "a", value: "1", category: "note", source: "test" });
    await store.put({ key: "b", value: "2", category: "note", source: "test" });

    const limited = await store.list({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("upserts on a repeated key, preserving createdAt and updating updatedAt", async () => {
    const store = createTestStore(tickingClock());
    const first = await store.put({ key: "k", value: "v1", category: "note", source: "test" });
    const second = await store.put({ key: "k", value: "v2", category: "note", source: "test" });

    expect(second.key).toBe(first.key);
    expect(second.value).toBe("v2");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).not.toBe(first.updatedAt);

    await expect(store.list({ limit: 10 })).resolves.toHaveLength(1);
  });

  it("deletes an existing key and reports absence for a missing one", async () => {
    const store = createTestStore(tickingClock());
    await store.put({ key: "k", value: "v", category: "note", source: "test" });

    await expect(store.delete("k")).resolves.toBe(true);
    await expect(store.delete("k")).resolves.toBe(false);
    await expect(store.list({ limit: 10 })).resolves.toEqual([]);
  });

  it("orders list results by most recently updated first", async () => {
    const store = createTestStore(tickingClock());
    await store.put({ key: "old", value: "1", category: "note", source: "test" });
    await store.put({ key: "new", value: "2", category: "note", source: "test" });

    const listed = await store.list({ limit: 10 });
    expect(listed.map((memory) => memory.key)).toEqual(["new", "old"]);
  });

  it("evicts the least-recently-updated memory once the retention cap is exceeded", async () => {
    const store = createTestStore(tickingClock(), 2);
    await store.put({ key: "oldest", value: "1", category: "note", source: "test" });
    await store.put({ key: "middle", value: "2", category: "note", source: "test" });
    await store.put({ key: "newest", value: "3", category: "note", source: "test" });

    const listed = await store.list({ limit: 10 });
    expect(listed.map((memory) => memory.key)).toEqual(["newest", "middle"]);
  });

  it("keeps a re-written key alive instead of evicting it as stale", async () => {
    const store = createTestStore(tickingClock(), 2);
    await store.put({ key: "a", value: "1", category: "note", source: "test" });
    await store.put({ key: "b", value: "1", category: "note", source: "test" });
    // Touching "a" again makes it the most recently updated, so "b" (now the
    // least-recently-updated) is evicted instead.
    await store.put({ key: "a", value: "2", category: "note", source: "test" });
    await store.put({ key: "c", value: "1", category: "note", source: "test" });

    const listed = await store.list({ limit: 10 });
    expect(listed.map((memory) => memory.key).sort()).toEqual(["a", "c"]);
  });
});

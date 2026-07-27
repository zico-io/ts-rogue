import { afterEach, describe, expect, it, vi } from "vitest";

import type { Memory, MemoryStore } from "./memory-store";
import {
  forgetExecute,
  recallExecute,
  recallInputSchema,
  rememberExecute,
  rememberInputSchema,
} from "./memory-tools";

const SAMPLE_MEMORY: Memory = {
  key: "workaround.eve-sandbox-flake",
  value: "Retried sandbox creation twice before it stabilized.",
  category: "workaround",
  source: "HAR-74 session",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    list: vi.fn(async () => []),
    put: vi.fn(async () => SAMPLE_MEMORY),
    delete: vi.fn(async () => true),
    ...overrides,
  };
}

describe("rememberInputSchema", () => {
  it("accepts a well-formed fact", () => {
    const result = rememberInputSchema.safeParse({
      key: "workaround.eve-sandbox-flake",
      value: "v",
      category: "workaround",
      source: "test",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a key with characters outside the allowed set", () => {
    const result = rememberInputSchema.safeParse({
      key: "Workaround With Spaces",
      value: "v",
      category: "workaround",
      source: "test",
    });
    expect(result.success).toBe(false);
  });
});

describe("rememberExecute", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards a valid fact straight to the store", async () => {
    const store = fakeStore();
    const input = {
      key: "workaround.eve-sandbox-flake",
      value: "Retried sandbox creation twice before it stabilized.",
      category: "workaround",
      source: "HAR-74 session",
    };

    await expect(rememberExecute(input, store)).resolves.toEqual(SAMPLE_MEMORY);
    expect(store.put).toHaveBeenCalledWith(input);
  });
});

describe("recallExecute", () => {
  it("defaults to a limit of 50 with no category filter", async () => {
    const store = fakeStore();
    await recallExecute(recallInputSchema.parse({}), store);
    expect(store.list).toHaveBeenCalledWith({ category: undefined, limit: 50 });
  });

  it("passes an explicit category and limit through", async () => {
    const store = fakeStore();
    await recallExecute(
      recallInputSchema.parse({ category: "workaround", limit: 5 }),
      store,
    );
    expect(store.list).toHaveBeenCalledWith({ category: "workaround", limit: 5 });
  });
});

describe("forgetExecute", () => {
  it("reports deletion of an existing key", async () => {
    const store = fakeStore({ delete: vi.fn(async () => true) });
    await expect(forgetExecute({ key: "k" }, store)).resolves.toEqual({
      deleted: true,
    });
    expect(store.delete).toHaveBeenCalledWith("k");
  });

  it("reports absence for a missing key", async () => {
    const store = fakeStore({ delete: vi.fn(async () => false) });
    await expect(forgetExecute({ key: "missing" }, store)).resolves.toEqual({
      deleted: false,
    });
  });
});

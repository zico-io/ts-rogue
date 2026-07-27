import { afterEach, describe, expect, it, vi } from "vitest";

import type { Memory, MemoryStore } from "./memory-store";
import {
  containsSensitiveContent,
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

  it("rejects a category outside the allow-list", () => {
    const result = rememberInputSchema.safeParse({
      key: "k",
      value: "v",
      category: "wishlist",
      source: "test",
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ["a GitHub token", "the fix used ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["an AWS access key ID", "found AKIAABCDEFGHIJKLMNOP in the log"],
    ["a PEM private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIB..."],
    ["a labeled password", "password: hunter2fallback"],
  ])("rejects a value containing %s", (_label, value) => {
    const result = rememberInputSchema.safeParse({
      key: "k",
      value,
      category: "workaround",
      source: "test",
    });
    expect(result.success).toBe(false);
  });

  it("accepts ordinary prose that merely mentions credentials in the abstract", () => {
    const result = rememberInputSchema.safeParse({
      key: "k",
      value: "Remember: never log the GitHub token, mint it fresh instead.",
      category: "workaround",
      source: "test",
    });
    expect(result.success).toBe(true);
  });
});

describe("containsSensitiveContent", () => {
  it("flags recognizable secret shapes", () => {
    expect(containsSensitiveContent("sk-abcdefghijklmnopqrstuvwx")).toBe(true);
    expect(containsSensitiveContent("my ssn is 123-45-6789")).toBe(true);
  });

  it("leaves plain text alone", () => {
    expect(containsSensitiveContent("the sandbox flaked twice before stabilizing")).toBe(false);
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
    } as const;

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

  it("rejects a category outside the allow-list", () => {
    expect(recallInputSchema.safeParse({ category: "wishlist" }).success).toBe(false);
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

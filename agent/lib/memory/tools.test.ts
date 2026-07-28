import { describe, expect, it } from "vitest";

import {
  containsSensitiveContent,
  recallInputSchema,
  rememberInputSchema,
} from "./tools";

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
    expect(
      containsSensitiveContent("the sandbox flaked twice before stabilizing"),
    ).toBe(false);
  });
});

describe("recallInputSchema", () => {
  it("defaults to a limit of 50 with no category filter", () => {
    expect(recallInputSchema.parse({})).toEqual({
      category: undefined,
      limit: 50,
    });
  });

  it("passes an explicit category and limit through", () => {
    expect(
      recallInputSchema.parse({ category: "workaround", limit: 5 }),
    ).toEqual({ category: "workaround", limit: 5 });
  });

  it("rejects a category outside the allow-list", () => {
    expect(recallInputSchema.safeParse({ category: "wishlist" }).success).toBe(
      false,
    );
  });
});

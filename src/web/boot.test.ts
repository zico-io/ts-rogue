import { describe, expect, it } from "vitest";
import { parseBootFlags } from "./boot";

describe("parseBootFlags", () => {
  it("falls back to a time-based seed when absent", () => {
    const before = Date.now();
    const flags = parseBootFlags("");
    const after = Date.now();
    expect(flags.seed).toBeGreaterThanOrEqual(before);
    expect(flags.seed).toBeLessThanOrEqual(after);
    expect(flags.fresh).toBe(false);
    expect(flags.dev).toBe(false);
  });

  it("parses an explicit seed param as a number", () => {
    const flags = parseBootFlags("?seed=42");
    expect(flags.seed).toBe(42);
  });

  it("treats fresh and dev as presence-only flags", () => {
    const flags = parseBootFlags("?seed=1&fresh&dev");
    expect(flags.fresh).toBe(true);
    expect(flags.dev).toBe(true);
  });

  it("omits fresh and dev when absent", () => {
    const flags = parseBootFlags("?seed=1");
    expect(flags.fresh).toBe(false);
    expect(flags.dev).toBe(false);
  });

  it("falls back to a time-based seed when seed is non-numeric", () => {
    const before = Date.now();
    const flags = parseBootFlags("?seed=not-a-number");
    const after = Date.now();
    expect(flags.seed).toBeGreaterThanOrEqual(before);
    expect(flags.seed).toBeLessThanOrEqual(after);
  });
});

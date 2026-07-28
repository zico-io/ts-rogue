import { describe, expect, it } from "vitest";

import { truncateForContext } from "./truncate-for-context";

describe("truncateForContext", () => {
  it("returns short text unchanged", () => {
    const text = "line one\nline two\nline three";
    expect(truncateForContext(text)).toBe(text);
  });

  it("keeps head and tail and elides the middle of a long output", () => {
    const lines = Array.from({ length: 5_000 }, (_, i) => `line ${i}`);
    const text = lines.join("\n");

    const out = truncateForContext(text);

    // Much shorter than the original.
    expect(out.length).toBeLessThan(text.length);
    // The first 200 and last 100 lines survive; the interior does not.
    expect(out).toContain("line 0");
    expect(out).toContain("line 199");
    expect(out).toContain("line 4900");
    expect(out).toContain("line 4999");
    expect(out).not.toContain("line 2500");
    // Elision marker names both dimensions that were dropped.
    expect(out).toContain("lines /");
    expect(out).toContain("chars elided");
  });

  it("keeps an output right at the line budget intact", () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i}`).join("\n");

    expect(truncateForContext(text)).toBe(text);
  });

  it("caps a single newline-free megastring by character count", () => {
    const text = "x".repeat(500_000);

    const out = truncateForContext(text);

    expect(out.length).toBeLessThan(text.length);
    // The line pass is a no-op (one line), so the char ceiling must fire.
    expect(out).toContain("chars elided");
    // Retained content stays within the ceiling.
    expect(out.replace(/\n… \[.*?\] …\n/, "").length).toBeLessThanOrEqual(
      40_000,
    );
  });

  it("uses no em dash in the elision markers, per repo convention", () => {
    const manyLines = Array.from({ length: 5_000 }, (_, i) => `l${i}`).join(
      "\n",
    );

    expect(truncateForContext(manyLines)).not.toContain("—");
    expect(truncateForContext("y".repeat(500_000))).not.toContain("—");
  });
});

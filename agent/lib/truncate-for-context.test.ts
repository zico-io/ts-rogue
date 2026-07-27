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

    const out = truncateForContext(text, { headLines: 10, tailLines: 5 });

    // Much shorter than the original.
    expect(out.length).toBeLessThan(text.length);
    // Head and tail survive; the interior does not.
    expect(out).toContain("line 0");
    expect(out).toContain("line 4999");
    expect(out).not.toContain("line 2500");
    // Elision marker names both dimensions that were dropped.
    expect(out).toContain("lines /");
    expect(out).toContain("chars elided");
  });

  it("caps a single newline-free megastring by character count", () => {
    const text = "x".repeat(500_000);

    const out = truncateForContext(text, { maxChars: 10_000 });

    expect(out.length).toBeLessThan(text.length);
    // The line pass is a no-op (one line), so the char ceiling must fire.
    expect(out).toContain("chars elided");
    // Retained content stays close to the requested ceiling.
    expect(out.replace(/\n… \[.*?\] …\n/, "").length).toBeLessThanOrEqual(
      10_000,
    );
  });
});

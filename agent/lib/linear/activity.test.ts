import { describe, expect, it } from "vitest";

import { activityText, MAX_ACTIVITY_TEXT_LENGTH } from "./activity";

describe("activityText", () => {
  it("leaves text that already fits untouched", () => {
    expect(activityText("✓ exit 0 · 3 lines")).toBe("✓ exit 0 · 3 lines");
  });

  it("fits oversized text within the cap", () => {
    const result = activityText("x".repeat(500));
    expect(result.length).toBe(MAX_ACTIVITY_TEXT_LENGTH);
    expect(result.endsWith("…")).toBe(true);
  });

  it("keeps a trailing URL intact", () => {
    const url = "https://github.com/example/repo/pull/1234";
    const result = activityText(`${"context ".repeat(50)}${url}`);
    expect(result.endsWith(url)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_ACTIVITY_TEXT_LENGTH);
  });

  it("closes a fence the cut left open, still within the cap", () => {
    const fenced = `✗ exit 1\n\`\`\`\n${Array.from({ length: 60 }, (_, i) => `line ${i} of failing output`).join("\n")}\n\`\`\``;
    const result = activityText(fenced);
    expect((result.match(/```/g) ?? []).length).toBe(2);
    expect(result.endsWith("```")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(MAX_ACTIVITY_TEXT_LENGTH);
  });

  it("does not append a fence when the cut lands before the opening one", () => {
    const result = activityText(`${"a".repeat(400)}\n\`\`\`\ncode\n\`\`\``);
    expect(result).not.toContain("```");
  });
});

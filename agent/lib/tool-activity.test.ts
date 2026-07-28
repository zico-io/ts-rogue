import { describe, expect, it } from "vitest";

import { toolActionParameter, toolActionResult } from "./tool-activity";

describe("toolActionParameter", () => {
  it("shows the command for bash", () => {
    expect(toolActionParameter("bash", { command: "gh pr view 132" })).toBe(
      "gh pr view 132",
    );
  });

  it("shows the path for file tools, with offset when present", () => {
    expect(
      toolActionParameter("read_file", { filePath: "/workspace/a.ts" }),
    ).toBe("/workspace/a.ts");
    expect(
      toolActionParameter("read_file", {
        filePath: "/workspace/a.ts",
        offset: 40,
      }),
    ).toBe("/workspace/a.ts:40");
    expect(
      toolActionParameter("write_file", { filePath: "/workspace/b.ts" }),
    ).toBe("/workspace/b.ts");
  });

  it("shows the pattern for grep, scoped by glob", () => {
    expect(toolActionParameter("grep", { pattern: "TODO" })).toBe("TODO");
    expect(toolActionParameter("grep", { pattern: "TODO", glob: "*.ts" })).toBe(
      "TODO in *.ts",
    );
  });

  it.each([
    ["playtester", "Playtester", "Test the new combat system"],
    ["agent", "Agent", "Update the config file"],
  ])(
    "formats a %s subagent parameter as '<name> - <first line of message>'",
    (toolName, label, message) => {
      expect(toolActionParameter(toolName, { message })).toBe(
        `${label} - ${message}`,
      );
    },
  );

  it("takes only the first line of a multi-line subagent message", () => {
    expect(
      toolActionParameter("playtester", {
        message: "Verify the new combat system.\nOther details...",
      }),
    ).toBe("Playtester - Verify the new combat system.");
  });

  it("returns a long parameter in full, leaving the cap to the channel", () => {
    const longMessage = "x".repeat(350);
    expect(toolActionParameter("playtester", { message: longMessage })).toBe(
      `Playtester - ${longMessage}`,
    );
  });

  it("falls back to JSON for unknown/MCP tools", () => {
    expect(toolActionParameter("linear__save_issue", { title: "x" })).toBe(
      '{"title":"x"}',
    );
    const blob = "y".repeat(500);
    expect(toolActionParameter("something_unknown", { blob })).toBe(
      JSON.stringify({ blob }),
    );
  });

  it("never throws on malformed input", () => {
    expect(() => toolActionParameter("bash", undefined)).not.toThrow();
    expect(() => toolActionParameter("bash", null)).not.toThrow();
    expect(toolActionParameter("read_file", 42)).toBe("42");
  });
});

describe("toolActionResult", () => {
  it("summarizes a bash success with exit code and line count, prefixed with glyph", () => {
    expect(
      toolActionResult("bash", {
        exitCode: 0,
        stderr: "",
        stdout: "a\nb\nc",
        truncated: false,
      }),
    ).toBe("✓ exit 0 · 3 lines");
  });

  it("surfaces stderr on a nonzero bash exit with failure glyph, fenced if multiline", () => {
    const out = toolActionResult("bash", {
      exitCode: 1,
      stderr: "fatal: not a git repository\nmore error",
      stdout: "",
      truncated: false,
    });
    expect(out).toContain("✗");
    expect(out).toContain("exit 1");
    // Multi-line stderr should be fenced
    expect(out).toContain("```");
  });

  it("counts array outputs with tool-specific nouns", () => {
    expect(toolActionResult("grep", ["m1", "m2"])).toBe("2 matches");
    expect(toolActionResult("glob", ["a"])).toBe("1 file");
  });

  it("counts read_file lines from a string output", () => {
    expect(toolActionResult("read_file", "l1\nl2\nl3\nl4")).toBe("4 lines");
  });

  it("bash success summarizes stdout as a line count rather than fencing it", () => {
    const result = toolActionResult("bash", {
      exitCode: 0,
      stdout: "line 1\nline 2\nline 3",
      stderr: "",
      truncated: false,
    });
    expect(result).toBe("✓ exit 0 · 3 lines");
  });

  it("fences a raw multi-line string result for a non-bash tool", () => {
    // Falls through rawResult's generic string branch, which fences
    // multi-line text rather than echoing it as a flat run-on string.
    const result = toolActionResult("something_unknown", "line1\nline2\nline3");
    expect(result).toBe("```\nline1\nline2\nline3\n```");
  });

  it("returns a long fenced result whole, fence closed, for the channel to fit", () => {
    const longStderr = Array.from(
      { length: 40 },
      (_, i) => `stderr line ${i}`,
    ).join("\n");
    const result = toolActionResult("bash", {
      exitCode: 1,
      stderr: longStderr,
      stdout: "",
      truncated: false,
    });
    expect(result).toContain(longStderr);
    expect((result.match(/```/g) ?? []).length).toBe(2);
  });

  it("renders an error summary with failure glyph when the tool failed", () => {
    expect(toolActionResult("bash", { message: "boom" }, true)).toBe("✗ boom");
    expect(toolActionResult("read_file", undefined, true)).toBe("✗ error");
  });

  it("never throws on malformed output", () => {
    expect(() => toolActionResult("bash", undefined)).not.toThrow();
    expect(() => toolActionResult("glob", null)).not.toThrow();
  });
});

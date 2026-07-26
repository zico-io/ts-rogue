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
    ["coder", "Coder", "Implement the gold display in the status bar"],
    ["scout", "Scout", "Find where the player sprite is rendered."],
    ["playtester", "Playtester", "Test the new combat system"],
    ["reviewer", "Reviewer", "Review the PR for security issues"],
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
      toolActionParameter("scout", {
        message: "Find where the player sprite is rendered.\nOther details...",
      }),
    ).toBe("Scout - Find where the player sprite is rendered.");
  });

  it("formats Workflow's parameter from its js input, not a message field", () => {
    expect(
      toolActionParameter("Workflow", { js: "await tools.coder({...})" }),
    ).toBe("Workflow - await tools.coder({...})");
  });

  it("truncates long subagent messages", () => {
    const longMessage = "x".repeat(350);
    const result = toolActionParameter("coder", { message: longMessage });
    expect(result.length).toBeLessThanOrEqual(301); // 300 + ellipsis
    expect(result).toContain("Coder");
    expect(result.endsWith("…")).toBe(true);
  });

  it("preserves full trailing URLs through truncation", () => {
    const textWithUrl = `Some context ${"y".repeat(250)} https://github.com/example/repo`;
    const result = toolActionParameter("bash", { command: textWithUrl });
    expect(result.endsWith("https://github.com/example/repo")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(301);
  });

  it("falls back to truncated JSON for unknown/MCP tools", () => {
    expect(toolActionParameter("linear__save_issue", { title: "x" })).toBe(
      '{"title":"x"}',
    );
    const long = { blob: "y".repeat(500) };
    const out = toolActionParameter("something_unknown", long);
    expect(out.length).toBeLessThanOrEqual(301); // 300 + the ellipsis
    expect(out.endsWith("…")).toBe(true);
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

  it("re-closes a code fence that truncation would otherwise leave open", () => {
    const longStderr = Array.from({ length: 40 }, (_, i) => `stderr line ${i}`).join(
      "\n",
    );
    const result = toolActionResult("bash", {
      exitCode: 1,
      stderr: longStderr,
      stdout: "",
      truncated: false,
    });
    const fenceCount = (result.match(/```/g) ?? []).length;
    expect(fenceCount % 2).toBe(0);
  });

  it("renders an error summary with failure glyph when the tool failed", () => {
    expect(toolActionResult("bash", { message: "boom" }, true)).toBe(
      "✗ boom",
    );
    expect(toolActionResult("read_file", undefined, true)).toBe("✗ error");
  });

  it("preserves a trailing URL when a long error result gets truncated", () => {
    const url = "https://github.com/example/repo/pull/1234";
    const message = `${"context ".repeat(50)}${url}`;
    const result = toolActionResult("bash", { message }, true);
    expect(result.endsWith(url)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(301);
  });

  it("never throws on malformed output", () => {
    expect(() => toolActionResult("bash", undefined)).not.toThrow();
    expect(() => toolActionResult("glob", null)).not.toThrow();
  });
});

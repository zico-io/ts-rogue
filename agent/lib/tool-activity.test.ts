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
  it("summarizes a bash success with exit code and line count", () => {
    expect(
      toolActionResult("bash", {
        exitCode: 0,
        stderr: "",
        stdout: "a\nb\nc",
        truncated: false,
      }),
    ).toBe("exit 0 · 3 lines");
  });

  it("surfaces stderr on a nonzero bash exit", () => {
    const out = toolActionResult("bash", {
      exitCode: 1,
      stderr: "fatal: not a git repository\nmore",
      stdout: "",
      truncated: false,
    });
    expect(out).toContain("exit 1");
    expect(out).toContain("fatal: not a git repository");
    expect(out).not.toContain("more");
  });

  it("counts array outputs with tool-specific nouns", () => {
    expect(toolActionResult("grep", ["m1", "m2"])).toBe("2 matches");
    expect(toolActionResult("glob", ["a"])).toBe("1 file");
  });

  it("counts read_file lines from a string output", () => {
    expect(toolActionResult("read_file", "l1\nl2\nl3\nl4")).toBe("4 lines");
  });

  it("renders an error summary when the tool failed", () => {
    expect(toolActionResult("bash", { message: "boom" }, true)).toBe(
      "error - boom",
    );
    expect(toolActionResult("read_file", undefined, true)).toBe("error");
  });

  it("never throws on malformed output", () => {
    expect(() => toolActionResult("bash", undefined)).not.toThrow();
    expect(() => toolActionResult("glob", null)).not.toThrow();
  });
});

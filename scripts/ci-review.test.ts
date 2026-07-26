import { describe, expect, it } from "vitest";
import { extractReviewJson, parseDiffAddedLines } from "./ci-review";

describe("parseDiffAddedLines", () => {
  it("records a simple added line in a single file", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index abc..def 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,0 +2,3 @@",
      "+const x = 1;",
      "+const y = 2;",
      "+const z = 3;",
    ].join("\n");

    const result = parseDiffAddedLines(diff);
    expect([...result.keys()]).toEqual(["src/foo.ts"]);
    expect([...result.get("src/foo.ts")!]).toEqual([2, 3, 4]);
  });

  it("records only + lines, not - lines, and context advances the counter", () => {
    const diff = [
      "diff --git a/src/bar.ts b/src/bar.ts",
      "index abc..def 100644",
      "--- a/src/bar.ts",
      "+++ b/src/bar.ts",
      "@@ -10,7 +10,8 @@",
      " unchanged context line",
      "-removed line",
      "+added line",
      " more context",
      "-another removed",
      "+another added",
    ].join("\n");

    const result = parseDiffAddedLines(diff);
    const lines = result.get("src/bar.ts")!;
    // Hunk starts at new-line 10.
    //   line 10: " " (context) -> counter becomes 11
    //   line 11: "-" (removed) -> counter stays 11
    //   line 11: "+" (added) -> record 11, counter becomes 12
    //   line 12: " " (context) -> counter becomes 13
    //   line 13: "-" (removed) -> counter stays 13
    //   line 13: "+" (added) -> record 13, counter becomes 14
    expect([...lines]).toEqual([11, 13]);
  });

  it("handles multiple hunks in one file", () => {
    const diff = [
      "diff --git a/src/multi.ts b/src/multi.ts",
      "index abc..def 100644",
      "--- a/src/multi.ts",
      "+++ b/src/multi.ts",
      "@@ -1,0 +1,2 @@",
      "+line a",
      "+line b",
      "@@ -10,0 +12,2 @@",
      "+line c",
      "+line d",
    ].join("\n");

    const result = parseDiffAddedLines(diff);
    const lines = result.get("src/multi.ts")!;
    // Hunk 1: new-line starts at 1 -> record 1, 2
    // Hunk 2: new-line starts at 12 -> record 12, 13
    expect([...lines]).toEqual([1, 2, 12, 13]);
  });

  it("handles multiple files in one diff", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index abc..def 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,0 +1,1 @@",
      "+first file",
      "diff --git a/src/b.ts b/src/b.ts",
      "index ghi..jkl 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -5,0 +6,1 @@",
      "+second file",
    ].join("\n");

    const result = parseDiffAddedLines(diff);
    expect([...result.keys()]).toEqual(["src/a.ts", "src/b.ts"]);
    expect([...result.get("src/a.ts")!]).toEqual([1]);
    expect([...result.get("src/b.ts")!]).toEqual([6]);
  });
});

describe("extractReviewJson", () => {
  it("parses a plain JSON string", () => {
    const input = '{"event":"COMMENT","body":"net: clean. Ship.","comments":[]}';
    expect(extractReviewJson(input)).toEqual({
      event: "COMMENT",
      body: "net: clean. Ship.",
      comments: [],
    });
  });

  it("parses JSON wrapped in a ```json fence", () => {
    const input = [
      '```json',
      '{"event":"COMMENT","body":"net: clean. Ship.","comments":[]}',
      '```',
    ].join("\n");
    expect(extractReviewJson(input)).toEqual({
      event: "COMMENT",
      body: "net: clean. Ship.",
      comments: [],
    });
  });

  it("parses JSON wrapped in a bare ``` fence (no language tag)", () => {
    const input = [
      '```',
      '{"event":"COMMENT","body":"net: clean. Ship.","comments":[]}',
      '```',
    ].join("\n");
    expect(extractReviewJson(input)).toEqual({
      event: "COMMENT",
      body: "net: clean. Ship.",
      comments: [],
    });
  });
});

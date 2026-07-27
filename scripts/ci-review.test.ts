import { describe, expect, it } from "vitest";
import {
  extractReviewJson,
  filterCommentsToValidLines,
  parseDiffAddedLines,
  parseReview,
  restrictDiffToPaths,
} from "./ci-review";

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
    expect([...(result.get("src/foo.ts") ?? new Set())]).toEqual([2, 3, 4]);
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
    const lines = result.get("src/bar.ts") ?? new Set();

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
    const lines = result.get("src/multi.ts") ?? new Set();

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
    expect([...(result.get("src/a.ts") ?? new Set())]).toEqual([1]);
    expect([...(result.get("src/b.ts") ?? new Set())]).toEqual([6]);
  });
});

describe("extractReviewJson", () => {
  it("parses a plain JSON string", () => {
    const input =
      '{"event":"COMMENT","body":"net: clean. Ship.","comments":[]}';
    expect(extractReviewJson(input)).toEqual({
      event: "COMMENT",
      body: "net: clean. Ship.",
      comments: [],
    });
  });

  it("parses JSON wrapped in a ```json fence", () => {
    const input = [
      "```json",
      '{"event":"COMMENT","body":"net: clean. Ship.","comments":[]}',
      "```",
    ].join("\n");
    expect(extractReviewJson(input)).toEqual({
      event: "COMMENT",
      body: "net: clean. Ship.",
      comments: [],
    });
  });

  it("parses JSON wrapped in a bare ``` fence (no language tag)", () => {
    const input = [
      "```",
      '{"event":"COMMENT","body":"net: clean. Ship.","comments":[]}',
      "```",
    ].join("\n");
    expect(extractReviewJson(input)).toEqual({
      event: "COMMENT",
      body: "net: clean. Ship.",
      comments: [],
    });
  });
});

describe("parseReview", () => {
  it("normalizes model-supplied comment sides for GitHub", () => {
    const input =
      '{"event":"COMMENT","body":"review","comments":[{"path":"agent/agent.ts","line":1,"side":"right","body":"shrink: test"}]}';

    expect(parseReview(input).comments[0]?.side).toBe("RIGHT");
  });

  it("rejects invalid comment sides", () => {
    const input =
      '{"event":"COMMENT","body":"review","comments":[{"path":"agent/agent.ts","line":1,"side":"LEFT","body":"shrink: test"}]}';

    expect(() => parseReview(input)).toThrow();
  });
});

describe("filterCommentsToValidLines", () => {
  it("keeps a comment whose line is valid in the supplied diff", () => {
    const validLines = new Map([["src/foo.ts", new Set([2, 3])]]);
    const comments = [
      { path: "src/foo.ts", line: 2, side: "RIGHT" as const, body: "note" },
    ];

    expect(filterCommentsToValidLines(comments, validLines)).toEqual(
      comments,
    );
  });

  it("drops a comment valid only against an incremental diff, not the full PR diff", () => {
    // Regression for HAR-80: GitHub's create-review API validates comment
    // paths/lines against the full base...head PR diff, not an incremental
    // BEFORE_SHA...HEAD_SHA diff. A comment that a smaller incremental diff
    // considers valid must still be dropped if it does not resolve against
    // the full PR diff, or GitHub responds 422 "Path could not be resolved".
    const incrementalDiff = [
      "diff --git a/src/renamed-only-recently.ts b/src/renamed-only-recently.ts",
      "index abc..def 100644",
      "--- a/src/renamed-only-recently.ts",
      "+++ b/src/renamed-only-recently.ts",
      "@@ -1,0 +2,1 @@",
      "+const x = 1;",
    ].join("\n");
    const incrementalValidLines = parseDiffAddedLines(incrementalDiff);

    // The full PR diff never touches this path (e.g. it was reverted or
    // renamed earlier in the PR's history), so GitHub's compare view has no
    // matching file/line to anchor the comment to.
    const fullDiff = [
      "diff --git a/src/other.ts b/src/other.ts",
      "index abc..def 100644",
      "--- a/src/other.ts",
      "+++ b/src/other.ts",
      "@@ -1,0 +1,1 @@",
      "+const y = 2;",
    ].join("\n");
    const fullValidLines = parseDiffAddedLines(fullDiff);

    const comments = [
      {
        path: "src/renamed-only-recently.ts",
        line: 2,
        side: "RIGHT" as const,
        body: "note",
      },
    ];

    expect(filterCommentsToValidLines(comments, incrementalValidLines)).toEqual(
      comments,
    );
    expect(filterCommentsToValidLines(comments, fullValidLines)).toEqual([]);
  });
});

describe("restrictDiffToPaths", () => {
  it("keeps only the file blocks whose path is in the allow-list", () => {
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

    const result = restrictDiffToPaths(diff, new Set(["src/b.ts"]));

    expect(result).toContain("src/b.ts");
    expect(result).not.toContain("src/a.ts");
  });

  it("regression for HAR-84: a file only touched by a merged-in base branch commit never reaches the model", () => {
    // A BEFORE_SHA...HEAD_SHA diff can include a file that landed via merging
    // the base branch into the PR branch (e.g. another PR's changes), rather
    // than a real PR edit. GitHub's compare view never shows that file, so
    // filterCommentsToValidLines always drops comments on it - meaning a
    // review that only found issues there previously posted zero inline
    // comments while still claiming findings in its summary. Restricting by
    // the true full-diff path set keeps that file out of the prompt entirely.
    const fullDiff = [
      "diff --git a/src/engine/state/store.ts b/src/engine/state/store.ts",
      "index abc..def 100644",
      "--- a/src/engine/state/store.ts",
      "+++ b/src/engine/state/store.ts",
      "@@ -1,0 +1,1 @@",
      "+real PR change",
    ].join("\n");

    const result = restrictDiffToPaths(
      fullDiff,
      new Set(["src/engine/state/store.ts", "src/engine/world/types.ts"]),
    );

    expect(parseDiffAddedLines(result).has("src/engine/world/types.ts")).toBe(
      false,
    );
    expect(result).toContain("src/engine/state/store.ts");
  });

  it("produces a diff whose valid lines are always a subset of the full diff's", () => {
    const fullDiff = [
      "diff --git a/src/engine/state/store.ts b/src/engine/state/store.ts",
      "index abc..def 100644",
      "--- a/src/engine/state/store.ts",
      "+++ b/src/engine/state/store.ts",
      "@@ -1,0 +1,1 @@",
      "+real PR change",
    ].join("\n");

    const restricted = restrictDiffToPaths(
      fullDiff,
      new Set(["src/engine/state/store.ts"]),
    );

    const fullValidLines = parseDiffAddedLines(fullDiff);
    const restrictedValidLines = parseDiffAddedLines(restricted);

    for (const [path, lines] of restrictedValidLines) {
      for (const line of lines) {
        expect(fullValidLines.get(path)?.has(line)).toBe(true);
      }
    }
  });
});

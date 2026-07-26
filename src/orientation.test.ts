import { describe, expect, it } from "vitest";

import {
  buildOrientationBrief,
  parseGitFacts,
  parseScreenshotToolingStatus,
} from "../agent/lib/orientation";

describe("parseGitFacts", () => {
  it("splits branch, sha, cleanliness, and commits from the command output", () => {
    const stdout = [
      "nico/rog-66-rework-scene-framing",
      "3f43215",
      "clean",
      "---COMMITS---",
      "3f43215 feat(ui): graphics overhaul",
      "910913e Multi-member party support",
    ].join("\n");

    expect(parseGitFacts(stdout)).toEqual({
      branch: "nico/rog-66-rework-scene-framing",
      headSha: "3f43215",
      clean: true,
      recentCommits: [
        "3f43215 feat(ui): graphics overhaul",
        "910913e Multi-member party support",
      ],
      upstream: null,
      unpushedCount: 0,
      worktrees: [],
    });
  });

  it("lists linked worktrees, excluding the main checkout", () => {
    const stdout = [
      "main",
      "abc1234",
      "clean",
      "---COMMITS---",
      "abc1234 fix: thing",
      "---UPSTREAM---",
      "origin/main",
      "---AHEAD---",
      "0",
      "---WORKTREES---",
      "worktree /workspace",
      "HEAD abc1234abc1234",
      "branch refs/heads/main",
      "",
      "worktree /workspace/.worktrees/ROG-12",
      "HEAD def5678def5678",
      "branch refs/heads/nico/rog-12-thing",
    ].join("\n");

    expect(parseGitFacts(stdout).worktrees).toEqual([
      "/workspace/.worktrees/ROG-12",
    ]);
  });

  it("reports a dirty tree and tolerates a truncated (no-commits) output", () => {
    const facts = parseGitFacts("main\nabc1234\ndirty\n");
    expect(facts.clean).toBe(false);
    expect(facts.recentCommits).toEqual([]);
    expect(facts.upstream).toBeNull();
    expect(facts.unpushedCount).toBe(0);
  });

  it("parses a tracked branch that is fully pushed (0 ahead)", () => {
    const stdout = [
      "nico/har-5-fix",
      "abc1234",
      "clean",
      "---COMMITS---",
      "abc1234 fix: thing",
      "---UPSTREAM---",
      "origin/nico/har-5-fix",
      "---AHEAD---",
      "0",
    ].join("\n");

    const facts = parseGitFacts(stdout);
    expect(facts.upstream).toBe("origin/nico/har-5-fix");
    expect(facts.unpushedCount).toBe(0);
  });

  it("parses a tracked branch with commits stranded ahead of its upstream", () => {
    const stdout = [
      "nico/har-5-fix",
      "abc1234",
      "dirty",
      "---COMMITS---",
      "abc1234 fix: thing",
      "---UPSTREAM---",
      "origin/nico/har-5-fix",
      "---AHEAD---",
      "2",
    ].join("\n");

    const facts = parseGitFacts(stdout);
    expect(facts.upstream).toBe("origin/nico/har-5-fix");
    expect(facts.unpushedCount).toBe(2);
  });

  it("parses a branch with no upstream (NONE) as null, ignoring any ahead count", () => {
    const stdout = [
      "nico/har-5-fix",
      "abc1234",
      "dirty",
      "---COMMITS---",
      "abc1234 fix: thing",
      "---UPSTREAM---",
      "NONE",
      "---AHEAD---",
      "0",
    ].join("\n");

    const facts = parseGitFacts(stdout);
    expect(facts.upstream).toBeNull();
    expect(facts.unpushedCount).toBe(0);
  });
});

describe("parseScreenshotToolingStatus", () => {
  it("reads an available status written by bootstrap", () => {
    expect(parseScreenshotToolingStatus('{"available":true}')).toEqual({
      available: true,
      reason: undefined,
    });
  });

  it("reads an unavailable status with its reason", () => {
    expect(
      parseScreenshotToolingStatus(
        '{"available":false,"reason":"playwright chromium failed to install or launch during sandbox bootstrap"}',
      ),
    ).toEqual({
      available: false,
      reason:
        "playwright chromium failed to install or launch during sandbox bootstrap",
    });
  });

  it("treats a missing/empty file as unavailable with a default reason instead of throwing", () => {
    const status = parseScreenshotToolingStatus("");
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();
  });

  it("treats malformed JSON as unavailable instead of throwing", () => {
    const status = parseScreenshotToolingStatus("not json");
    expect(status.available).toBe(false);
    expect(status.reason).toBeTruthy();
  });
});

describe("buildOrientationBrief", () => {
  it("summarizes settled repository facts", () => {
    const brief = buildOrientationBrief({
      branch: "main",
      headSha: "abc1234",
      clean: true,
      recentCommits: ["abc1234 feat: thing"],
      upstream: "origin/main",
      unpushedCount: 0,
    });

    expect(brief).toContain("`main` at `abc1234`");
    expect(brief).toContain("Working tree: clean");
    expect(brief).toContain("- abc1234 feat: thing");
  });

  it("reports available screenshot tooling", () => {
    const brief = buildOrientationBrief(
      {
        branch: "main",
        headSha: "abc1234",
        clean: true,
        recentCommits: [],
        upstream: "origin/main",
        unpushedCount: 0,
      },
      { available: true },
    );
    expect(brief).toContain("Screenshot tooling");
    expect(brief).toContain("available");
  });

  it("reports unavailable screenshot tooling with its reason and the disclose-don't-omit instruction", () => {
    const brief = buildOrientationBrief(
      {
        branch: "main",
        headSha: "abc1234",
        clean: true,
        recentCommits: [],
        upstream: "origin/main",
        unpushedCount: 0,
      },
      { available: false, reason: "missing system libraries" },
    );
    expect(brief).toContain("unavailable (missing system libraries)");
    expect(brief).toContain("disclose missing visual evidence");
  });

  it("omits the screenshot-tooling line entirely when no status was supplied", () => {
    const brief = buildOrientationBrief({
      branch: "main",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
      upstream: "origin/main",
      unpushedCount: 0,
    });
    expect(brief).not.toContain("Screenshot tooling");
  });

  it("reports confirmed GitHub auth as working normally", () => {
    const brief = buildOrientationBrief(
      {
        branch: "main",
        headSha: "abc1234",
        clean: true,
        recentCommits: [],
        upstream: "origin/main",
        unpushedCount: 0,
      },
      undefined,
      true,
    );
    expect(brief).toContain("GitHub auth: confirmed");
  });

  it("reports unconfirmed GitHub auth with bounded retry guidance", () => {
    const brief = buildOrientationBrief(
      {
        branch: "main",
        headSha: "abc1234",
        clean: true,
        recentCommits: [],
        upstream: "origin/main",
        unpushedCount: 0,
      },
      undefined,
      false,
    );
    expect(brief).toContain("GitHub auth: not confirmed");

    expect(brief).toContain("retry failed operations twice");
    expect(brief).toContain("back up work");
  });

  it("omits the GitHub auth line entirely when no status was supplied", () => {
    const brief = buildOrientationBrief({
      branch: "main",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
      upstream: "origin/main",
      unpushedCount: 0,
    });
    expect(brief).not.toContain("GitHub auth");
  });

  it("never flags unpushed commits on main (main tracks origin; unpushed-on-main isn't actionable)", () => {
    const brief = buildOrientationBrief({
      branch: "main",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
      upstream: null,
      unpushedCount: 5,
    });
    expect(brief).not.toContain("unpushed");
    expect(brief).not.toContain("Upstream: none");
  });

  it("flags a feature branch with no upstream yet and points at the fix", () => {
    const brief = buildOrientationBrief({
      branch: "nico/har-5-fix",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
      upstream: null,
      unpushedCount: 0,
    });
    expect(brief).toContain("Upstream: none");
    expect(brief).toContain("git push -u origin nico/har-5-fix");
  });

  it("flags a feature branch with commits stranded ahead of its upstream", () => {
    const brief = buildOrientationBrief({
      branch: "nico/har-5-fix",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
      upstream: "origin/nico/har-5-fix",
      unpushedCount: 3,
    });
    expect(brief).toContain("3 commit(s)");
    expect(brief).toContain("ahead of `origin/nico/har-5-fix`");
    expect(brief).toContain("backup procedure in `instructions.md`");
  });

  it("surfaces leftover worktrees with push-before-remove guidance", () => {
    const brief = buildOrientationBrief({
      branch: "main",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
      upstream: "origin/main",
      unpushedCount: 0,
      worktrees: ["/workspace/.worktrees/ROG-12"],
    });
    expect(brief).toContain("Leftover worktrees");
    expect(brief).toContain("/workspace/.worktrees/ROG-12");
    expect(brief).toContain("preserve their commits");
  });

  it("omits the worktree line when none are left behind", () => {
    const brief = buildOrientationBrief({
      branch: "main",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
      upstream: "origin/main",
      unpushedCount: 0,
      worktrees: [],
    });
    expect(brief).not.toContain("worktree");
  });

  it("stays quiet about push state on a feature branch that's fully pushed", () => {
    const brief = buildOrientationBrief({
      branch: "nico/har-5-fix",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
      upstream: "origin/nico/har-5-fix",
      unpushedCount: 0,
    });
    expect(brief).not.toContain("unpushed");
    expect(brief).not.toContain("Upstream: none");
  });
});

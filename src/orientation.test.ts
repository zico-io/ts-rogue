import { describe, expect, it } from "vitest";

import { buildOrientationBrief, parseGitFacts } from "../agent/lib/orientation";

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
    });
  });

  it("reports a dirty tree and tolerates a truncated (no-commits) output", () => {
    const facts = parseGitFacts("main\nabc1234\ndirty\n");
    expect(facts.clean).toBe(false);
    expect(facts.recentCommits).toEqual([]);
  });
});

describe("buildOrientationBrief", () => {
  it("states settled facts and forbids re-deriving them", () => {
    const brief = buildOrientationBrief({
      branch: "main",
      headSha: "abc1234",
      clean: true,
      recentCommits: ["abc1234 feat: thing"],
    });

    expect(brief).toContain("`main` at `abc1234`");
    expect(brief).toContain("Working tree: clean");
    expect(brief).toContain("do not re-derive it");
    expect(brief).toContain("- abc1234 feat: thing");
  });
});

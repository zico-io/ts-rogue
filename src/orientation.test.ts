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
    });
  });

  it("reports a dirty tree and tolerates a truncated (no-commits) output", () => {
    const facts = parseGitFacts("main\nabc1234\ndirty\n");
    expect(facts.clean).toBe(false);
    expect(facts.recentCommits).toEqual([]);
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

  it("reports available screenshot tooling as a hard requirement for UI-visual PRs", () => {
    const brief = buildOrientationBrief(
      { branch: "main", headSha: "abc1234", clean: true, recentCommits: [] },
      { available: true },
    );
    expect(brief).toContain("Screenshot tooling");
    expect(brief).toContain("available");
    expect(brief).toContain("must include a screenshot");
  });

  it("reports unavailable screenshot tooling with its reason and the disclose-don't-omit instruction", () => {
    const brief = buildOrientationBrief(
      { branch: "main", headSha: "abc1234", clean: true, recentCommits: [] },
      { available: false, reason: "missing system libraries" },
    );
    expect(brief).toContain("unavailable (missing system libraries)");
    expect(brief).toContain("say so explicitly");
  });

  it("omits the screenshot-tooling line entirely when no status was supplied", () => {
    const brief = buildOrientationBrief({
      branch: "main",
      headSha: "abc1234",
      clean: true,
      recentCommits: [],
    });
    expect(brief).not.toContain("Screenshot tooling");
  });
});

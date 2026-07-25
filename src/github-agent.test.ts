import type { GitHubPullRequestEvent } from "eve/channels/github";
import { describe, expect, it } from "vitest";

import {
  isMainMerge,
  linearRefFromPullRequest,
} from "../agent/channels/github";

describe("GitHub agent events", () => {
  it("wakes only for merged pull requests targeting main", () => {
    const pullRequest = {
      action: "closed",
      headSha: "abc",
      pullRequestNumber: 1,
      raw: { base: { ref: "main" }, merged: true },
    };

    expect(isMainMerge(pullRequest)).toBe(true);
    expect(
      isMainMerge({
        ...pullRequest,
        raw: { ...pullRequest.raw, merged: false },
      }),
    ).toBe(false);
    expect(
      isMainMerge({
        ...pullRequest,
        raw: { ...pullRequest.raw, base: { ref: "release" } },
      }),
    ).toBe(false);
  });

  it("extracts the closed Linear issue from the branch, title, or body", () => {
    const pr = (raw: GitHubPullRequestEvent["raw"]) => ({
      action: "closed" as const,
      headSha: "abc",
      pullRequestNumber: 1,
      raw,
    });

    expect(
      linearRefFromPullRequest(pr({ head: { ref: "nico/rog-42-tavern" } })),
    ).toBe("ROG-42");
    expect(
      linearRefFromPullRequest(pr({ title: "Fix ROG-7 loot table" })),
    ).toBe("ROG-7");
    expect(
      linearRefFromPullRequest(pr({ head: { ref: "chore/cleanup" } })),
    ).toBeNull();
    // Branch wins over body so the advance targets the issue the branch names.
    expect(
      linearRefFromPullRequest(
        pr({ head: { ref: "feat/ROG-3" }, body: "relates to ROG-99" }),
      ),
    ).toBe("ROG-3");
  });

  it("recognizes every driven team key, not just ROG", () => {
    const pr = (raw: GitHubPullRequestEvent["raw"]) => ({
      action: "closed" as const,
      headSha: "abc",
      pullRequestNumber: 1,
      raw,
    });

    expect(
      linearRefFromPullRequest(pr({ head: { ref: "nico/eng-1-fast-travel" } })),
    ).toBe("ENG-1");
    expect(linearRefFromPullRequest(pr({ title: "HAR-9: scoping gate" }))).toBe(
      "HAR-9",
    );
    expect(linearRefFromPullRequest(pr({ body: "closes WEB-2" }))).toBe(
      "WEB-2",
    );
    // Hyphenated-number tokens that are not team keys must not match.
    expect(
      linearRefFromPullRequest(
        pr({ body: "hashed with SHA-256, dates in ISO-8601" }),
      ),
    ).toBeNull();
  });
});

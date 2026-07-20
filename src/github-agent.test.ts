import { describe, expect, it } from "vitest";

import { isMainMerge } from "../agent/channels/github";

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
});

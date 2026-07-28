import { describe, expect, it } from "vitest";

import {
  DEBT_ISSUE_LABEL,
  DEBT_REMEDIATION_THRESHOLD,
  debtReviewContext,
  pullRequestReviewVerdictContext,
} from "./dispatch-context";

describe("debtReviewContext (HAR-18)", () => {
  it("returns a string containing PR number, repo, label, threshold, and turn reference", () => {
    const result = debtReviewContext(42);

    expect(result).toContain("#42 in zico-io/ts-rogue");
    expect(result).toContain(DEBT_ISSUE_LABEL);
    expect(result).toContain(String(DEBT_REMEDIATION_THRESHOLD));
    expect(result).toContain("GitHub maintenance turns");
  });
});

describe("pullRequestReviewVerdictContext (HAR-49)", () => {
  it("formats an approval verdict with reviewer name and body", () => {
    const payload = {
      action: "submitted" as const,
      pull_request: {
        number: 1,
        base: { ref: "main", sha: "abc" },
        head: { ref: "feat/thing", sha: "def" },
      },
      review: {
        state: "approved" as const,
        body: "Looks good!",
        html_url:
          "https://github.com/zico-io/ts-rogue/pull/1#pullrequestreview-1",
        user: { login: "alice", id: 1, type: "User" },
      },
      repository: {
        id: 7,
        name: "ts-rogue",
        owner: { login: "zico-io" },
      },
    };

    const result = pullRequestReviewVerdictContext(payload, "approved");

    expect(result).toContain("**Approved**");
    expect(result).toContain("@alice");
    expect(result).toContain("Looks good!");
    expect(result).toContain(payload.review.html_url);
  });

  it("formats a changes-requested verdict with fallback sender login", () => {
    const payload = {
      action: "submitted" as const,
      pull_request: {
        number: 2,
        base: { ref: "main", sha: "abc" },
        head: { ref: "feat/thing", sha: "def" },
      },
      review: {
        state: "changes_requested" as const,
        body: null,
        user: undefined,
        html_url: undefined,
      },
      repository: {
        id: 7,
        name: "ts-rogue",
        owner: { login: "zico-io" },
      },
      sender: { login: "bob", id: 2, type: "User" },
    };

    const result = pullRequestReviewVerdictContext(
      payload,
      "changes_requested",
    );

    expect(result).toContain("**Changes requested**");
    expect(result).toContain("@bob");
  });
});

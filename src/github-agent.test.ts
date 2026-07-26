import type {
  GitHubComment,
  GitHubInboundContext,
  GitHubPullRequestEvent,
} from "eve/channels/github";
import { describe, expect, it } from "vitest";

import {
  DEBT_ISSUE_LABEL,
  DEBT_REMEDIATION_THRESHOLD,
  debtReviewContext,
  isBotMentioned,
  isMainMerge,
  linearRefFromPullRequest,
  onAuthorizationCompleted,
  onAuthorizationRequired,
  onComment,
  onMessageCompleted,
  onPullRequest,
  REVIEW_ONLY_TURN_ATTRIBUTE,
} from "../agent/channels/github";

const fakeContext = (
  kind: GitHubInboundContext["conversation"]["kind"],
): GitHubInboundContext =>
  ({
    conversation: {
      issueNumber: kind === "issue" ? 1 : null,
      kind,
      pullRequestNumber: 1,
    },
    delivery: { event: "test", hookId: undefined, id: "delivery-1" },
    github: {
      installationId: 1,
      repository: {
        fullName: "zico-io/ts-rogue",
        id: 1,
        name: "ts-rogue",
        owner: "zico-io",
        private: false,
      },
      request: async () => {
        throw new Error("not used in this test");
      },
    },
    repository: {
      fullName: "zico-io/ts-rogue",
      id: 1,
      name: "ts-rogue",
      owner: "zico-io",
      private: false,
    },
    sender: {
      htmlUrl: undefined,
      id: 2,
      login: "a-human-reviewer",
      type: "User",
      url: undefined,
    },
    thread: {
      kind,
      post: async () => ({
        htmlUrl: undefined,
        id: 0,
        raw: undefined,
        url: undefined,
      }),
      react: async () => {},
    },
  }) as unknown as GitHubInboundContext;

const fakeComment = (
  body: string,
  raw: GitHubComment["raw"] = {},
): GitHubComment => ({
  author: undefined,
  body,
  htmlUrl: undefined,
  id: 1,
  raw,
  url: undefined,
});

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

  it("matches an @mention of the bot by name, case-insensitively, as a whole token", () => {
    expect(
      isBotMentioned("hey @ts-rogue-eve please look", "ts-rogue-eve"),
    ).toBe(true);
    expect(
      isBotMentioned("hey @TS-ROGUE-EVE please look", "ts-rogue-eve"),
    ).toBe(true);
    expect(isBotMentioned("no mention here", "ts-rogue-eve")).toBe(false);
    // A longer handle sharing the same prefix must not false-positive.
    expect(
      isBotMentioned("cc @ts-rogue-eve-2 for visibility", "ts-rogue-eve"),
    ).toBe(false);
    expect(isBotMentioned("hey @ts-rogue-eve", undefined)).toBe(false);
  });

  it("dispatches a review thread's new finding unconditionally, without a mention", () => {
    const result = onComment(
      fakeContext("review_thread"),
      fakeComment("this looks off, please fix"),
    );

    expect(result).not.toBeNull();
    expect(result?.context).toEqual([
      expect.stringContaining("PR review-feedback turns"),
    ]);
  });

  it("skips a reply within an already-open review thread", () => {
    const result = onComment(
      fakeContext("review_thread"),
      fakeComment("thanks, fixed", { in_reply_to_id: 1 }),
    );

    expect(result).toBeNull();
  });

  it("still requires a mention for ordinary issue/PR discussion comments", () => {
    expect(
      onComment(
        fakeContext("pull_request"),
        fakeComment("just chatting, no mention"),
      ),
    ).toBeNull();
  });

  const fakeOpenPr = (
    overrides: Partial<GitHubPullRequestEvent> = {},
  ): GitHubPullRequestEvent =>
    ({
      action: "opened",
      headSha: "abc",
      pullRequestNumber: 7,
      raw: { base: { ref: "main" }, head: { ref: "feat/thing" } },
      ...overrides,
    }) as GitHubPullRequestEvent;

  it("auto-reviews a newly opened pull request and marks the turn review-only", () => {
    const result = onPullRequest(fakeContext("pull_request"), fakeOpenPr());

    expect(result).not.toBeNull();
    expect(result?.context?.[0]).toContain("Ponytail-review pull request #7");
    expect(result?.auth?.attributes[REVIEW_ONLY_TURN_ATTRIBUTE]).toBe("true");
  });

  it("re-reviews on every push to the pull request (synchronize), not just when opened", () => {
    const result = onPullRequest(
      fakeContext("pull_request"),
      fakeOpenPr({ action: "synchronize" }),
    );

    expect(result).not.toBeNull();
    expect(result?.auth?.attributes[REVIEW_ONLY_TURN_ATTRIBUTE]).toBe("true");
  });

  it("scopes a re-review's diff to just what changed since the last review", () => {
    const result = onPullRequest(
      fakeContext("pull_request"),
      fakeOpenPr({
        action: "synchronize",
        raw: {
          base: { ref: "main" },
          head: { ref: "feat/thing" },
          before: "sha-from-last-review",
        },
      }),
    );

    const context = result?.context?.[0] ?? "";
    expect(context).toContain(
      "git diff sha-from-last-review...origin/feat/thing",
    );
    expect(context).toContain(
      "Review ONLY the diff introduced since the last review",
    );
    // The full base diff must not be the one instructed for a re-review.
    expect(context).not.toContain("git diff origin/main...origin/feat/thing");
  });

  it("falls back to the full PR diff on the initial review (opened), not a since-last-review diff", () => {
    const result = onPullRequest(fakeContext("pull_request"), fakeOpenPr());

    const context = result?.context?.[0] ?? "";
    expect(context).toContain("git diff origin/main...origin/feat/thing");
    expect(context).not.toContain(
      "Review ONLY the diff introduced since the last review",
    );
  });

  it("falls back to the full PR diff for a synchronize event missing `before`", () => {
    const result = onPullRequest(
      fakeContext("pull_request"),
      fakeOpenPr({ action: "synchronize" }),
    );

    const context = result?.context?.[0] ?? "";
    expect(context).toContain("git diff origin/main...origin/feat/thing");
    expect(context).not.toContain(
      "Review ONLY the diff introduced since the last review",
    );
  });

  it("skips auto-review for a draft pull request", () => {
    expect(
      onPullRequest(
        fakeContext("pull_request"),
        fakeOpenPr({
          raw: {
            base: { ref: "main" },
            head: { ref: "feat/thing" },
            draft: true,
          },
        }),
      ),
    ).toBeNull();
  });

  it("takes no action on other pull-request events, like plain synchronization noise from a merge", () => {
    expect(
      onPullRequest(
        fakeContext("pull_request"),
        fakeOpenPr({ action: "labeled" }),
      ),
    ).toBeNull();
  });

  const fakeChannel = () => {
    const posted: string[] = [];
    return {
      posted,
      channel: {
        thread: {
          post: async (body: string) => {
            posted.push(body);
            return {
              htmlUrl: undefined,
              id: 0,
              raw: undefined,
              url: undefined,
            };
          },
        },
      } as unknown as Parameters<typeof onMessageCompleted>[1],
    };
  };

  const fakeSessionContext = (
    reviewOnly: boolean,
  ): Parameters<typeof onMessageCompleted>[2] =>
    ({
      session: {
        auth: {
          initiator: reviewOnly
            ? {
                attributes: { [REVIEW_ONLY_TURN_ATTRIBUTE]: "true" },
                authenticator: "github-webhook",
                principalId: "github:2",
                principalType: "user",
              }
            : null,
        },
      },
    }) as unknown as Parameters<typeof onMessageCompleted>[2];

  it("skips posting the trailing reply for a ponytail review-only turn (HAR-24 duplicate)", async () => {
    const { channel, posted } = fakeChannel();

    await onMessageCompleted(
      { finishReason: "stop", message: "Review posted: net: clean. Ship." },
      channel,
      fakeSessionContext(true),
    );

    expect(posted).toEqual([]);
  });

  it("still posts the reply for an ordinary (non-review-only) turn", async () => {
    const { channel, posted } = fakeChannel();

    await onMessageCompleted(
      { finishReason: "stop", message: "Fixed as requested." },
      channel,
      fakeSessionContext(false),
    );

    expect(posted).toEqual(["Fixed as requested."]);
  });

  it("never posts for tool-call-only or empty completions", async () => {
    const { channel, posted } = fakeChannel();

    await onMessageCompleted(
      { finishReason: "tool-calls", message: "ignored" },
      channel,
      fakeSessionContext(false),
    );
    await onMessageCompleted(
      { finishReason: "stop", message: null },
      channel,
      fakeSessionContext(false),
    );

    expect(posted).toEqual([]);
  });
});

describe("debt-review context (HAR-18)", () => {
  it("includes debt-review context on every main-merge dispatch", () => {
    const pullRequest = {
      action: "closed" as const,
      headSha: "abc",
      pullRequestNumber: 42,
      raw: { base: { ref: "main" }, merged: true },
    };

    const result = onPullRequest(fakeContext("pull_request"), pullRequest);

    expect(result).not.toBeNull();
    expect(result?.context).toEqual(
      expect.arrayContaining([
        expect.stringContaining("#42 in zico-io/ts-rogue"),
      ]),
    );
  });

  it("debtReviewContext returns a string containing PR number, repo, label, threshold, and turn reference", () => {
    const result = debtReviewContext(42);

    expect(result).toContain("#42 in zico-io/ts-rogue");
    expect(result).toContain(DEBT_ISSUE_LABEL);
    expect(result).toContain(String(DEBT_REMEDIATION_THRESHOLD));
    expect(result).toContain("PR merge debt-review turns");
  });
});

describe("authorization events surface the OAuth challenge (HAR-33)", () => {
  // Without these handlers a user-scoped connection challenge on a
  // GitHub-dispatched turn parks the turn invisibly - the silent merge-wake
  // stall. GitHub has no auth signal, so the challenge is a thread comment.
  const fakeChannel = () => {
    const posted: string[] = [];
    return {
      posted,
      channel: {
        thread: {
          post: async (body: string) => {
            posted.push(body);
            return {
              htmlUrl: undefined,
              id: 0,
              raw: undefined,
              url: undefined,
            };
          },
        },
      } as unknown as Parameters<typeof onAuthorizationRequired>[1],
    };
  };
  const sessionCtx = {} as Parameters<typeof onAuthorizationRequired>[2];

  it("posts the challenge URL as a thread comment", async () => {
    const { channel, posted } = fakeChannel();

    await onAuthorizationRequired(
      {
        authorization: {
          displayName: "Linear MCP",
          url: "https://example.com/oauth",
        },
        description: "Authorize the linear connection",
        name: "linear",
      } as Parameters<typeof onAuthorizationRequired>[0],
      channel,
      sessionCtx,
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("I need Linear MCP connected");
    expect(posted[0]).toContain(
      "[Authorize Linear MCP](https://example.com/oauth)",
    );
  });

  it("title-cases the connection name and includes instructions and code for URL-less flows", async () => {
    const { channel, posted } = fakeChannel();

    await onAuthorizationRequired(
      {
        authorization: {
          instructions: "Approve the sign-in request on your phone.",
          userCode: "ABCD-1234",
        },
        description: "Authorize the vercel connection",
        name: "vercel",
      } as Parameters<typeof onAuthorizationRequired>[0],
      channel,
      sessionCtx,
    );

    expect(posted[0]).toContain("I need Vercel connected");
    expect(posted[0]).toContain("Approve the sign-in request on your phone.");
    expect(posted[0]).toContain("Code: `ABCD-1234`");
    expect(posted[0]).not.toContain("](");
  });

  it("posts a resuming note once authorization completes", async () => {
    const { channel, posted } = fakeChannel();

    await onAuthorizationCompleted(
      {
        authorization: { displayName: "Linear MCP" },
        name: "linear",
        outcome: "authorized",
      } as Parameters<typeof onAuthorizationCompleted>[0],
      channel,
      sessionCtx,
    );

    expect(posted).toEqual(["Connected to Linear MCP. Resuming."]);
  });

  it("reports a non-authorized outcome with its reason", async () => {
    const { channel, posted } = fakeChannel();

    await onAuthorizationCompleted(
      {
        name: "linear",
        outcome: "timed-out",
        reason: "challenge expired",
      } as Parameters<typeof onAuthorizationCompleted>[0],
      channel,
      sessionCtx,
    );

    expect(posted).toEqual([
      "Authorization for Linear timed out: challenge expired",
    ]);
  });
});

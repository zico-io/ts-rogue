import type {
  GitHubComment,
  GitHubInboundContext,
  GitHubPullRequestEvent,
} from "eve/channels/github";
import { describe, expect, it, vi } from "vitest";

import {
  DEBT_ISSUE_LABEL,
  DEBT_REMEDIATION_THRESHOLD,
  debtReviewContext,
  handlePullRequestReviewWebhook,
  isBotMentioned,
  isMainMerge,
  linearRefFromPullRequest,
  onAuthorizationCompleted,
  onAuthorizationRequired,
  onComment,
  onMessageCompleted,
  onPullRequest,
  pullRequestReviewVerdict,
  pullRequestReviewVerdictContext,
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
      expect.stringContaining("GitHub maintenance turns"),
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

  it("returns null for opened, ready_for_review, and synchronize events (review dispatch moved to CI)", () => {
    expect(onPullRequest(fakeContext("pull_request"), fakeOpenPr())).toBeNull();
    expect(
      onPullRequest(
        fakeContext("pull_request"),
        fakeOpenPr({ action: "ready_for_review" }),
      ),
    ).toBeNull();
    expect(
      onPullRequest(
        fakeContext("pull_request"),
        fakeOpenPr({ action: "synchronize" }),
      ),
    ).toBeNull();
  });

  it("returns null for a draft pull request (no dispatch needed)", () => {
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

  it("takes no action on other pull-request events, like labeled", () => {
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

  const fakeSessionContext = (): Parameters<typeof onMessageCompleted>[2] =>
    ({
      session: {
        auth: {
          initiator: null,
        },
      },
    }) as unknown as Parameters<typeof onMessageCompleted>[2];

  it("always posts the completed message for a non-tool-call turn (no more review-only skip)", async () => {
    const { channel, posted } = fakeChannel();

    await onMessageCompleted(
      { finishReason: "stop", message: "Review posted: net: clean. Ship." },
      channel,
      fakeSessionContext(),
    );

    expect(posted).toEqual(["Review posted: net: clean. Ship."]);
  });

  it("posts the reply for an ordinary (non-review-only) turn", async () => {
    const { channel, posted } = fakeChannel();

    await onMessageCompleted(
      { finishReason: "stop", message: "Fixed as requested." },
      channel,
      fakeSessionContext(),
    );

    expect(posted).toEqual(["Fixed as requested."]);
  });

  it("removes a redundant leading header before posting", async () => {
    const { channel, posted } = fakeChannel();

    await onMessageCompleted(
      { finishReason: "stop", message: "## Update\n\nFixed as requested." },
      channel,
      fakeSessionContext(),
    );

    expect(posted).toEqual(["Fixed as requested."]);
  });

  it("never posts for tool-call-only or empty completions", async () => {
    const { channel, posted } = fakeChannel();

    await onMessageCompleted(
      { finishReason: "tool-calls", message: "ignored" },
      channel,
      fakeSessionContext(),
    );
    await onMessageCompleted(
      { finishReason: "stop", message: null },
      channel,
      fakeSessionContext(),
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
    expect(result).toContain("GitHub maintenance turns");
  });
});

describe("authorization events surface the OAuth challenge (HAR-33)", () => {
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

describe("coarse pull_request_review webhook handler (HAR-49)", () => {
  describe("pullRequestReviewVerdict", () => {
    it("returns 'approved' for submitted reviews with approved state", () => {
      expect(
        pullRequestReviewVerdict({
          action: "submitted",
          review: { state: "approved", body: null },
        }),
      ).toBe("approved");
    });

    it("returns 'changes_requested' for submitted reviews with changes_requested state", () => {
      expect(
        pullRequestReviewVerdict({
          action: "submitted",
          review: { state: "changes_requested", body: null },
        }),
      ).toBe("changes_requested");
    });

    it("returns null for submitted reviews with commented state", () => {
      expect(
        pullRequestReviewVerdict({
          action: "submitted",
          review: { state: "commented", body: null },
        }),
      ).toBeNull();
    });

    it("returns null for edited reviews with approved state", () => {
      expect(
        pullRequestReviewVerdict({
          action: "edited",
          review: { state: "approved", body: null },
        }),
      ).toBeNull();
    });

    it("returns null for dismissed reviews with approved state", () => {
      expect(
        pullRequestReviewVerdict({
          action: "dismissed",
          review: { state: "approved", body: null },
        }),
      ).toBeNull();
    });
  });

  describe("pullRequestReviewVerdictContext", () => {
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

  describe("handlePullRequestReviewWebhook", () => {
    it("wakes a turn for an approval verdict with correct continuation token and state", async () => {
      const sendFn = vi.fn().mockResolvedValue(undefined);
      const credentials = {
        webhookVerifier: async () => true,
      };
      const payload = {
        action: "submitted",
        installation: { id: 123 },
        pull_request: {
          number: 42,
          base: { ref: "main", sha: "baseSha123" },
          head: { ref: "feat/thing", sha: "headSha456" },
        },
        repository: {
          id: 7,
          name: "ts-rogue",
          owner: { login: "zico-io" },
          default_branch: "main",
          private: false,
        },
        review: {
          state: "approved",
          body: null,
          html_url:
            "https://github.com/zico-io/ts-rogue/pull/42#pullrequestreview-1",
          user: { login: "alice", id: 1, type: "User" },
        },
        sender: { login: "alice", id: 1, type: "User" },
      };

      const request = new Request("https://example.test/eve/v1/github", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "x-github-event": "pull_request_review",
          "x-github-delivery": "delivery-123",
        },
      });

      const response = await handlePullRequestReviewWebhook(
        request,
        { send: sendFn },
        credentials,
      );

      expect(response.ok).toBe(true);
      expect(sendFn).toHaveBeenCalledOnce();
      const call = sendFn.mock.calls[0];
      expect(call[0]).toContain("**Approved**");
      expect(call[1].continuationToken).toBe("repo:7:pull:42");
      expect(call[1].state.pullRequestNumber).toBe(42);
      expect(call[1].state.baseSha).toBe("baseSha123");
      expect(call[1].state.headSha).toBe("headSha456");
    });

    it("wakes a turn for a changes-requested verdict", async () => {
      const sendFn = vi.fn().mockResolvedValue(undefined);
      const credentials = {
        webhookVerifier: async () => true,
      };
      const payload = {
        action: "submitted",
        installation: { id: 123 },
        pull_request: {
          number: 99,
          base: { ref: "main", sha: "baseSha" },
          head: { ref: "feat/thing", sha: "headSha" },
        },
        repository: {
          id: 7,
          name: "ts-rogue",
          owner: { login: "zico-io" },
          default_branch: "main",
          private: false,
        },
        review: {
          state: "changes_requested",
          body: "Please address these issues",
          html_url:
            "https://github.com/zico-io/ts-rogue/pull/99#pullrequestreview-1",
          user: { login: "bob", id: 2, type: "User" },
        },
        sender: { login: "bob", id: 2, type: "User" },
      };

      const request = new Request("https://example.test/eve/v1/github", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "x-github-event": "pull_request_review",
        },
      });

      const response = await handlePullRequestReviewWebhook(
        request,
        { send: sendFn },
        credentials,
      );

      expect(response.ok).toBe(true);
      expect(sendFn).toHaveBeenCalledOnce();
      const call = sendFn.mock.calls[0];
      expect(call[0]).toContain("**Changes requested**");
      expect(call[1].continuationToken).toBe("repo:7:pull:99");
    });

    it("does not call send for a commented review", async () => {
      const sendFn = vi.fn();
      const credentials = {
        webhookVerifier: async () => true,
      };
      const payload = {
        action: "submitted",
        installation: { id: 123 },
        pull_request: {
          number: 42,
          base: { ref: "main" },
          head: { ref: "feat/thing" },
        },
        repository: {
          id: 7,
          name: "ts-rogue",
          owner: { login: "zico-io" },
        },
        review: {
          state: "commented",
          body: null,
          user: { login: "alice", id: 1, type: "User" },
        },
      };

      const request = new Request("https://example.test/eve/v1/github", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "x-github-event": "pull_request_review",
        },
      });

      const response = await handlePullRequestReviewWebhook(
        request,
        { send: sendFn },
        credentials,
      );

      expect(response.ok).toBe(true);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it("returns 401 for unverified requests", async () => {
      const sendFn = vi.fn();
      const credentials = {
        webhookVerifier: async () => false,
      };
      const payload = {
        action: "submitted",
        installation: { id: 123 },
        pull_request: {
          number: 42,
          base: { ref: "main" },
          head: { ref: "feat/thing" },
        },
        repository: {
          id: 7,
          name: "ts-rogue",
          owner: { login: "zico-io" },
        },
        review: {
          state: "approved",
          body: null,
          user: { login: "alice", id: 1, type: "User" },
        },
      };

      const request = new Request("https://example.test/eve/v1/github", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "x-github-event": "pull_request_review",
        },
      });

      const response = await handlePullRequestReviewWebhook(
        request,
        { send: sendFn },
        credentials,
      );

      expect(response.status).toBe(401);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it("returns ok-true for malformed JSON without calling send", async () => {
      const sendFn = vi.fn();
      const credentials = {
        webhookVerifier: async () => true,
      };

      const request = new Request("https://example.test/eve/v1/github", {
        method: "POST",
        body: "not valid json",
        headers: {
          "x-github-event": "pull_request_review",
        },
      });

      const response = await handlePullRequestReviewWebhook(
        request,
        { send: sendFn },
        credentials,
      );

      expect(response.ok).toBe(true);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it("returns ok-true for well-formed JSON missing required fields without calling send", async () => {
      const sendFn = vi.fn();
      const credentials = {
        webhookVerifier: async () => true,
      };

      const request = new Request("https://example.test/eve/v1/github", {
        method: "POST",
        body: JSON.stringify({
          action: "submitted",
          pull_request: { number: 42 },
          repository: { id: 7, name: "ts-rogue" }, // missing owner.login
          review: { state: "approved", body: null },
        }),
        headers: {
          "x-github-event": "pull_request_review",
        },
      });

      const response = await handlePullRequestReviewWebhook(
        request,
        { send: sendFn },
        credentials,
      );

      expect(response.ok).toBe(true);
      expect(sendFn).not.toHaveBeenCalled();
    });

    it("returns ok-true and does not call send when an optional nested field has the wrong shape", async () => {
      const sendFn = vi.fn();
      const credentials = {
        webhookVerifier: async () => true,
      };

      const request = new Request("https://example.test/eve/v1/github", {
        method: "POST",
        body: JSON.stringify({
          action: "submitted",
          pull_request: { number: 42, base: "main" }, // base should be an object
          repository: { id: 7, name: "ts-rogue", owner: { login: "zico-io" } },
          review: { state: "approved", body: null },
        }),
        headers: {
          "x-github-event": "pull_request_review",
        },
      });

      const response = await handlePullRequestReviewWebhook(
        request,
        { send: sendFn },
        credentials,
      );

      expect(response.ok).toBe(true);
      expect(sendFn).not.toHaveBeenCalled();
    });
  });
});

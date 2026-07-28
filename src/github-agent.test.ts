import { describe, expect, it, vi } from "vitest";
import { githubSession } from "../agent/channels/github";
import { handlePullRequestReviewWebhook } from "../agent/lib/github";

// The wake and state-sync decisions these handlers render live in
// agent/lib - see agent/lib/{wake-policy,pull-request,dispatch-context}.test.ts.
// What is left here is the adapter's own job: what gets posted, and how a raw
// webhook delivery turns into a dispatched turn.

describe("GitHub reply rendering", () => {
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
      } as unknown as Parameters<typeof githubSession.messageCompleted>[1],
    };
  };

  const fakeSessionContext = (): Parameters<
    typeof githubSession.messageCompleted
  >[2] =>
    ({
      session: {
        auth: {
          initiator: null,
        },
      },
    }) as unknown as Parameters<typeof githubSession.messageCompleted>[2];

  it("always posts the completed message for a non-tool-call turn (no more review-only skip)", async () => {
    const { channel, posted } = fakeChannel();

    await githubSession.messageCompleted(
      { finishReason: "stop", message: "Review posted: net: clean. Ship." },
      channel,
      fakeSessionContext(),
    );

    expect(posted).toEqual(["Review posted: net: clean. Ship."]);
  });

  it("posts the reply for an ordinary (non-review-only) turn", async () => {
    const { channel, posted } = fakeChannel();

    await githubSession.messageCompleted(
      { finishReason: "stop", message: "Fixed as requested." },
      channel,
      fakeSessionContext(),
    );

    expect(posted).toEqual(["Fixed as requested."]);
  });

  it("removes a redundant leading header before posting", async () => {
    const { channel, posted } = fakeChannel();

    await githubSession.messageCompleted(
      { finishReason: "stop", message: "## Update\n\nFixed as requested." },
      channel,
      fakeSessionContext(),
    );

    expect(posted).toEqual(["Fixed as requested."]);
  });

  it("never posts for tool-call-only or empty completions", async () => {
    const { channel, posted } = fakeChannel();

    await githubSession.messageCompleted(
      { finishReason: "tool-calls", message: "ignored" },
      channel,
      fakeSessionContext(),
    );
    await githubSession.messageCompleted(
      { finishReason: "stop", message: null },
      channel,
      fakeSessionContext(),
    );

    expect(posted).toEqual([]);
  });

  it("splits a reply past GitHub's comment length cap into successive posts", async () => {
    const { channel, posted } = fakeChannel();
    const body = "x".repeat(65536 + 10);

    await githubSession.messageCompleted(
      { finishReason: "stop", message: body },
      channel,
      fakeSessionContext(),
    );

    expect(posted).toHaveLength(2);
    expect(posted[0]).toHaveLength(65536);
    expect(posted[1]).toHaveLength(10);
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
      } as unknown as Parameters<typeof githubSession.authorizationRequired>[1],
    };
  };
  const sessionCtx = {} as Parameters<
    typeof githubSession.authorizationRequired
  >[2];

  it("posts the challenge URL as a thread comment", async () => {
    const { channel, posted } = fakeChannel();

    await githubSession.authorizationRequired(
      {
        authorization: {
          displayName: "Linear MCP",
          url: "https://example.com/oauth",
        },
        description: "Authorize the linear connection",
        name: "linear",
      } as Parameters<typeof githubSession.authorizationRequired>[0],
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

    await githubSession.authorizationRequired(
      {
        authorization: {
          instructions: "Approve the sign-in request on your phone.",
          userCode: "ABCD-1234",
        },
        description: "Authorize the vercel connection",
        name: "vercel",
      } as Parameters<typeof githubSession.authorizationRequired>[0],
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

    await githubSession.authorizationCompleted(
      {
        authorization: { displayName: "Linear MCP" },
        name: "linear",
        outcome: "authorized",
      } as Parameters<typeof githubSession.authorizationCompleted>[0],
      channel,
      sessionCtx,
    );

    expect(posted).toEqual(["Connected to Linear MCP. Resuming."]);
  });

  it("reports a non-authorized outcome with its reason", async () => {
    const { channel, posted } = fakeChannel();

    await githubSession.authorizationCompleted(
      {
        name: "linear",
        outcome: "timed-out",
        reason: "challenge expired",
      } as Parameters<typeof githubSession.authorizationCompleted>[0],
      channel,
      sessionCtx,
    );

    expect(posted).toEqual([
      "Authorization for Linear timed out: challenge expired",
    ]);
  });
});

describe("coarse pull_request_review webhook handler (HAR-49)", () => {
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

  it("still dispatches when an optional nested field has the wrong shape, since downstream reads it defensively", async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
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
    expect(sendFn).toHaveBeenCalledOnce();
    const call = sendFn.mock.calls[0];
    expect(call[1].state.baseRef).toBeNull();
  });
});

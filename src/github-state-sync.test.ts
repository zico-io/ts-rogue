import { describe, expect, it, vi } from "vitest";

// The state-sync behavior itself is covered in agent/lib/github/pull-request.test.ts.
// This asserts only the wiring: that the channel hands eve the state-syncing
// decision rather than the bare wake decision.

const { capturedConfig } = vi.hoisted(() => ({
  capturedConfig: { current: null as Record<string, unknown> | null },
}));

vi.mock("@vercel/connect/eve", () => ({
  connectGitHubCredentials: () => ({}),
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/github", () => ({
  defaultGitHubAuth: () => ({ attributes: {} }),
  githubChannel: (config: Record<string, unknown>) => {
    capturedConfig.current = config;
    // A real GitHubChannel always carries its one HTTP POST route (see
    // agent/channels/github.ts's `baseRoute` destructure) - stub it here so
    // module load mirrors production instead of special-casing a bare mock.
    return {
      ...config,
      routes: [
        {
          method: "POST",
          path: "/eve/v1/github",
          handler: async () => new Response("mock"),
        },
      ],
    };
  },
}));

const { default: channel } = await import("../agent/channels/github");
const { pullRequestWakeDecision, syncAndWakeOnPullRequest } = await import(
  "../agent/lib/github/pull-request"
);
const { commentWakeDecision } = await import("../agent/lib/github/wake-policy");

const post = (event: string) =>
  new Request("https://example.test/eve/v1/github", {
    method: "POST",
    body: "{}",
    headers: { "x-github-event": event },
  });

// biome-ignore lint/suspicious/noExplicitAny: reaching into the mocked channel shape
const route = channel.routes[0] as any;

describe("channel wiring", () => {
  it("registers the state-syncing pull-request handler, not the bare wake decision", () => {
    expect(capturedConfig.current?.onPullRequest).toBe(
      syncAndWakeOnPullRequest,
    );
    expect(capturedConfig.current?.onPullRequest).not.toBe(
      pullRequestWakeDecision,
    );
  });

  it("registers the comment wake policy", () => {
    expect(capturedConfig.current?.onComment).toBe(commentWakeDecision);
  });

  it("routes pull_request_review to the HAR-49 override and everything else to eve", async () => {
    expect(channel.routes).toHaveLength(1);

    // The override reaches `handlePullRequestReviewWebhook`, which rejects the
    // mocked credentials (no webhookVerifier) rather than reaching eve.
    const intercepted = await route.handler(post("pull_request_review"), {
      send: async () => {},
    });
    expect(intercepted.status).toBe(401);

    const passthrough = await route.handler(post("pull_request"), {
      send: async () => {},
    });
    expect(await passthrough.text()).toBe("mock");
  });
});

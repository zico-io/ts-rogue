import { beforeEach, describe, expect, it, vi } from "vitest";

const { advanceIssueStateMock, capturedConfig } = vi.hoisted(() => ({
  advanceIssueStateMock: vi.fn(async () => {}),
  capturedConfig: { current: null as Record<string, unknown> | null },
}));

vi.mock("../agent/lib/issue-state", () => ({
  advanceIssueState: advanceIssueStateMock,
}));
vi.mock("@vercel/connect/eve", () => ({
  connectGitHubCredentials: () => ({}),
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/github", () => ({
  defaultGitHubAuth: () => ({ attributes: {} }),
  githubChannel: (config: Record<string, unknown>) => {
    capturedConfig.current = config;
    return config;
  },
}));

const { onPullRequest, pullRequestStateSync } = await import(
  "../agent/channels/github"
);

import type {
  GitHubInboundContext,
  GitHubPullRequestEvent,
} from "eve/channels/github";

const registeredOnPullRequest = capturedConfig.current?.onPullRequest as (
  ctx: GitHubInboundContext,
  pullRequest: GitHubPullRequestEvent,
) => Promise<ReturnType<typeof onPullRequest>>;

const pr = (
  action: string,
  raw: GitHubPullRequestEvent["raw"],
): GitHubPullRequestEvent =>
  ({
    action,
    headSha: "abc",
    pullRequestNumber: 7,
    raw,
  }) as unknown as GitHubPullRequestEvent;

const context = {
  conversation: { kind: "pull_request", pullRequestNumber: 7 },
} as unknown as GitHubInboundContext;

describe("pullRequestStateSync", () => {
  it("targets Done when a pull request merges into main", () => {
    expect(
      pullRequestStateSync(
        pr("closed", {
          base: { ref: "main" },
          head: { ref: "nico/har-9-scoping" },
          merged: true,
        }),
      ),
    ).toEqual({ issueRef: "HAR-9", target: "done" });
  });

  it("ignores merges into non-main branches", () => {
    expect(
      pullRequestStateSync(
        pr("closed", {
          base: { ref: "release" },
          head: { ref: "nico/har-9-scoping" },
          merged: true,
        }),
      ),
    ).toBeNull();
  });

  it("ignores a pull request closed without merging", () => {
    expect(
      pullRequestStateSync(
        pr("closed", {
          base: { ref: "main" },
          head: { ref: "nico/har-9-scoping" },
          merged: false,
        }),
      ),
    ).toBeNull();
  });

  it("targets In Review when a pull request opens", () => {
    expect(
      pullRequestStateSync(
        pr("opened", { base: { ref: "main" }, head: { ref: "feat/ROG-3" } }),
      ),
    ).toEqual({ issueRef: "ROG-3", target: "inReview" });
  });

  it("targets In Review when a draft becomes ready for review", () => {
    expect(
      pullRequestStateSync(
        pr("ready_for_review", {
          base: { ref: "main" },
          head: { ref: "feat/ROG-3" },
        }),
      ),
    ).toEqual({ issueRef: "ROG-3", target: "inReview" });
  });

  it("skips draft pull requests", () => {
    expect(
      pullRequestStateSync(
        pr("opened", {
          base: { ref: "main" },
          draft: true,
          head: { ref: "feat/ROG-3" },
        }),
      ),
    ).toBeNull();
  });

  it("skips synchronize events (state was set at open)", () => {
    expect(
      pullRequestStateSync(
        pr("synchronize", {
          base: { ref: "main" },
          head: { ref: "feat/ROG-3" },
        }),
      ),
    ).toBeNull();
  });

  it("skips pull requests naming no Linear issue", () => {
    expect(
      pullRequestStateSync(
        pr("opened", { base: { ref: "main" }, head: { ref: "chore/tidy" } }),
      ),
    ).toBeNull();
  });
});

describe("onPullRequest state-sync wrapper", () => {
  beforeEach(() => {
    advanceIssueStateMock.mockClear();
  });

  it("is what the channel registers", () => {
    expect(registeredOnPullRequest).toBeTypeOf("function");
    expect(registeredOnPullRequest).not.toBe(onPullRequest);
  });

  it("moves the issue to Done before returning the main-merge dispatch decision", async () => {
    const event = pr("closed", {
      base: { ref: "main" },
      head: { ref: "nico/har-9-scoping" },
      merged: true,
    });

    const result = await registeredOnPullRequest(context, event);

    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueRef: "HAR-9", target: "done" }),
    );
    expect(result).toEqual(onPullRequest(context, event));
    expect(result?.context?.join("\n")).toContain("HAR-9");
  });

  it("moves the issue to In Review and returns null (auto-review dispatch moved to CI)", async () => {
    const event = pr("opened", {
      base: { ref: "main" },
      head: { ref: "feat/ROG-3" },
    });

    const result = await registeredOnPullRequest(context, event);

    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueRef: "ROG-3", target: "inReview" }),
    );
    expect(result).toBeNull();
  });

  it("passes null decisions through untouched with no sync", async () => {
    const result = await registeredOnPullRequest(
      context,
      pr("labeled", { base: { ref: "main" }, head: { ref: "feat/ROG-3" } }),
    );

    expect(advanceIssueStateMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

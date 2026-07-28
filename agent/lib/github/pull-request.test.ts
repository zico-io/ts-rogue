import type {
  GitHubInboundContext,
  GitHubPullRequestEvent,
} from "eve/channels/github";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { advanceIssueStateMock } = vi.hoisted(() => ({
  advanceIssueStateMock: vi.fn(async () => {}),
}));

vi.mock("../linear/issue-state", () => ({
  advanceIssueState: advanceIssueStateMock,
}));
vi.mock("@vercel/connect/eve", () => ({
  connectGitHubCredentials: () => ({}),
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/github", () => ({
  defaultGitHubAuth: () => ({ attributes: {} }),
}));

const {
  isMainMerge,
  linearRefFromPullRequest,
  pullRequestStateSync,
  pullRequestWakeDecision,
  syncAndWakeOnPullRequest,
} = await import("./pull-request");

const pr = (
  action: string,
  raw: GitHubPullRequestEvent["raw"],
  pullRequestNumber = 7,
): GitHubPullRequestEvent =>
  ({
    action,
    headSha: "abc",
    pullRequestNumber,
    raw,
  }) as unknown as GitHubPullRequestEvent;

const context = {
  conversation: { kind: "pull_request", pullRequestNumber: 7 },
} as unknown as GitHubInboundContext;

describe("isMainMerge", () => {
  it("wakes only for merged pull requests targeting main", () => {
    const pullRequest = pr("closed", { base: { ref: "main" }, merged: true });

    expect(isMainMerge(pullRequest)).toBe(true);
    expect(
      isMainMerge(
        pr("closed", { base: { ref: "main" }, merged: false }) as never,
      ),
    ).toBe(false);
    expect(
      isMainMerge(
        pr("closed", { base: { ref: "release" }, merged: true }) as never,
      ),
    ).toBe(false);
  });
});

describe("linearRefFromPullRequest", () => {
  it("extracts the closed Linear issue from the branch, title, or body", () => {
    expect(
      linearRefFromPullRequest(
        pr("closed", { head: { ref: "nico/rog-42-tavern" } }),
      ),
    ).toBe("ROG-42");
    expect(
      linearRefFromPullRequest(pr("closed", { title: "Fix ROG-7 loot table" })),
    ).toBe("ROG-7");
    expect(
      linearRefFromPullRequest(
        pr("closed", { head: { ref: "chore/cleanup" } }),
      ),
    ).toBeNull();

    expect(
      linearRefFromPullRequest(
        pr("closed", {
          head: { ref: "feat/ROG-3" },
          body: "relates to ROG-99",
        }),
      ),
    ).toBe("ROG-3");
  });

  it("recognizes every driven team key, not just ROG", () => {
    expect(
      linearRefFromPullRequest(
        pr("closed", { head: { ref: "nico/eng-1-fast-travel" } }),
      ),
    ).toBe("ENG-1");
    expect(
      linearRefFromPullRequest(pr("closed", { title: "HAR-9: scoping gate" })),
    ).toBe("HAR-9");
    expect(
      linearRefFromPullRequest(pr("closed", { body: "closes WEB-2" })),
    ).toBe("WEB-2");

    expect(
      linearRefFromPullRequest(
        pr("closed", { body: "hashed with SHA-256, dates in ISO-8601" }),
      ),
    ).toBeNull();
  });
});

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

describe("pullRequestWakeDecision", () => {
  it("returns null for opened, ready_for_review, and synchronize events (review dispatch moved to CI)", () => {
    const raw = { base: { ref: "main" }, head: { ref: "feat/thing" } };

    expect(pullRequestWakeDecision(context, pr("opened", raw))).toBeNull();
    expect(
      pullRequestWakeDecision(context, pr("ready_for_review", raw)),
    ).toBeNull();
    expect(pullRequestWakeDecision(context, pr("synchronize", raw))).toBeNull();
  });

  it("returns null for a draft pull request (no dispatch needed)", () => {
    expect(
      pullRequestWakeDecision(
        context,
        pr("opened", {
          base: { ref: "main" },
          head: { ref: "feat/thing" },
          draft: true,
        }),
      ),
    ).toBeNull();
  });

  it("takes no action on other pull-request events, like labeled", () => {
    expect(
      pullRequestWakeDecision(
        context,
        pr("labeled", { base: { ref: "main" }, head: { ref: "feat/thing" } }),
      ),
    ).toBeNull();
  });

  it("includes debt-review context on every main-merge dispatch (HAR-18)", () => {
    const result = pullRequestWakeDecision(
      context,
      pr("closed", { base: { ref: "main" }, merged: true }, 42),
    );

    expect(result).not.toBeNull();
    expect(result?.context).toEqual(
      expect.arrayContaining([
        expect.stringContaining("#42 in zico-io/ts-rogue"),
      ]),
    );
  });
});

describe("syncAndWakeOnPullRequest", () => {
  beforeEach(() => {
    advanceIssueStateMock.mockClear();
  });

  it("moves the issue to Done before returning the main-merge dispatch decision", async () => {
    const event = pr("closed", {
      base: { ref: "main" },
      head: { ref: "nico/har-9-scoping" },
      merged: true,
    });

    const result = await syncAndWakeOnPullRequest(context, event);

    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueRef: "HAR-9", target: "done" }),
    );
    expect(result).toEqual(pullRequestWakeDecision(context, event));
    expect(result?.context?.join("\n")).toContain("HAR-9");
  });

  it("moves the issue to In Review and returns null (auto-review dispatch moved to CI)", async () => {
    const result = await syncAndWakeOnPullRequest(
      context,
      pr("opened", { base: { ref: "main" }, head: { ref: "feat/ROG-3" } }),
    );

    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueRef: "ROG-3", target: "inReview" }),
    );
    expect(result).toBeNull();
  });

  it("passes null decisions through untouched with no sync", async () => {
    const result = await syncAndWakeOnPullRequest(
      context,
      pr("labeled", { base: { ref: "main" }, head: { ref: "feat/ROG-3" } }),
    );

    expect(advanceIssueStateMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

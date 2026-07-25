import type {
  GitHubComment,
  GitHubInboundContext,
  GitHubPullRequestEvent,
} from "eve/channels/github";
import { describe, expect, it } from "vitest";

import {
  isBotMentioned,
  isMainMerge,
  linearRefFromPullRequest,
  onComment,
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

const fakeComment = (body: string): GitHubComment => ({
  author: undefined,
  body,
  htmlUrl: undefined,
  id: 1,
  raw: {},
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

  it("dispatches review-thread comments unconditionally, without a mention", () => {
    const result = onComment(
      fakeContext("review_thread"),
      fakeComment("this looks off, please fix"),
    );

    expect(result).not.toBeNull();
    expect(result?.context).toEqual([
      expect.stringContaining("PR review-feedback turns"),
    ]);
  });

  it("still requires a mention for ordinary issue/PR discussion comments", () => {
    expect(
      onComment(
        fakeContext("pull_request"),
        fakeComment("just chatting, no mention"),
      ),
    ).toBeNull();
  });
});

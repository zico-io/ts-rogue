import type { GitHubComment, GitHubInboundContext } from "eve/channels/github";
import { describe, expect, it, vi } from "vitest";

vi.mock("eve/channels/github", () => ({
  defaultGitHubAuth: () => ({ attributes: {} }),
}));

const {
  commentWakeDecision,
  isBotMentioned,
  parsePullRequestReviewPayload,
  pullRequestReviewVerdict,
} = await import("./wake-policy");

const fakeContext = (
  kind: GitHubInboundContext["conversation"]["kind"],
): GitHubInboundContext =>
  ({
    conversation: {
      issueNumber: kind === "issue" ? 1 : null,
      kind,
      pullRequestNumber: 1,
    },
    thread: { kind },
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

describe("isBotMentioned", () => {
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
});

describe("commentWakeDecision", () => {
  it("dispatches a review thread's new finding unconditionally, without a mention", () => {
    const result = commentWakeDecision(
      fakeContext("review_thread"),
      fakeComment("this looks off, please fix"),
    );

    expect(result).not.toBeNull();
    expect(result?.context).toEqual([
      expect.stringContaining("GitHub maintenance turns"),
    ]);
  });

  it("skips a reply within an already-open review thread", () => {
    const result = commentWakeDecision(
      fakeContext("review_thread"),
      fakeComment("thanks, fixed", { in_reply_to_id: 1 }),
    );

    expect(result).toBeNull();
  });

  it("still requires a mention for ordinary issue/PR discussion comments", () => {
    expect(
      commentWakeDecision(
        fakeContext("pull_request"),
        fakeComment("just chatting, no mention"),
      ),
    ).toBeNull();
  });
});

describe("pullRequestReviewVerdict (HAR-49)", () => {
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

describe("parsePullRequestReviewPayload", () => {
  const valid = {
    action: "submitted",
    pull_request: { number: 42 },
    repository: { id: 7, name: "ts-rogue", owner: { login: "zico-io" } },
    review: { state: "approved", body: null },
  };

  it("accepts a payload carrying every dereferenced field", () => {
    expect(parsePullRequestReviewPayload(valid)).not.toBeNull();
  });

  it("rejects a payload missing repository.owner.login", () => {
    expect(
      parsePullRequestReviewPayload({
        ...valid,
        repository: { id: 7, name: "ts-rogue" },
      }),
    ).toBeNull();
  });

  it("rejects a non-object payload, including an array", () => {
    expect(parsePullRequestReviewPayload([valid])).toBeNull();
    expect(parsePullRequestReviewPayload("nope")).toBeNull();
    expect(parsePullRequestReviewPayload(null)).toBeNull();
  });

  it("accepts a wrongly-shaped optional field, since downstream reads it defensively", () => {
    expect(
      parsePullRequestReviewPayload({
        ...valid,
        pull_request: { number: 42, base: "main" },
      }),
    ).not.toBeNull();
  });
});

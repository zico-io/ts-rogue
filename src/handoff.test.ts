import { beforeEach, describe, expect, it, vi } from "vitest";

// Handoff posts a Linear comment via the hand-rolled `commentCreate` mutation,
// then anchors a fresh Agent Session to that comment. These mocks stand in
// for the eve runtime and Linear GraphQL transport so both steps can be
// driven and asserted without a live session.
const { callGraphQL, createSessionOnComment } = vi.hoisted(() => ({
  callGraphQL: vi.fn(),
  createSessionOnComment: vi.fn(),
}));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  callLinearGraphQL: (input: unknown) => callGraphQL(input),
  createLinearAgentSessionOnComment: (input: unknown) =>
    createSessionOnComment(input),
}));
vi.mock("eve/tools", () => ({ defineTool: (def: unknown) => def }));

const handoffTool = (await import("../agent/tools/handoff"))
  .default as unknown as {
  execute: (input: {
    issueId: string;
    brief: string;
  }) => Promise<{ handoffSessionId: string; handoffSessionUrl: string | null }>;
};
const { createLinearComment } = await import("../agent/tools/handoff");

describe("handoff tool", () => {
  beforeEach(() => {
    callGraphQL.mockReset();
    createSessionOnComment.mockReset();
  });

  it("posts the CommentCreate mutation with issueId/body and returns the comment id", async () => {
    callGraphQL.mockResolvedValue({
      commentCreate: { success: true, comment: { id: "comment-1" } },
    });

    const commentId = await createLinearComment({
      issueId: "issue-uuid",
      body: "the continuation packet",
    });

    expect(commentId).toBe("comment-1");
    expect(callGraphQL).toHaveBeenCalledTimes(1);
    const call = callGraphQL.mock.calls[0]?.[0];
    expect(call.variables).toEqual({
      input: { issueId: "issue-uuid", body: "the continuation packet" },
    });
    expect(call.queryName).toBe("CommentCreate");
  });

  it("throws when Linear reports success: false", async () => {
    callGraphQL.mockResolvedValue({
      commentCreate: { success: false, comment: { id: "comment-1" } },
    });

    await expect(
      createLinearComment({ issueId: "issue-uuid", body: "brief" }),
    ).rejects.toThrow();
  });

  it("throws when no comment id comes back", async () => {
    callGraphQL.mockResolvedValue({
      commentCreate: { success: true, comment: {} },
    });

    await expect(
      createLinearComment({ issueId: "issue-uuid", body: "brief" }),
    ).rejects.toThrow();
  });

  it("chains comment-creation into createLinearAgentSessionOnComment and returns the new session", async () => {
    callGraphQL.mockResolvedValue({
      commentCreate: { success: true, comment: { id: "comment-9" } },
    });
    createSessionOnComment.mockResolvedValue({
      id: "session-9",
      url: "https://linear.app/session-9",
    });

    const result = await handoffTool.execute({
      issueId: "issue-uuid",
      brief: "continuation packet",
    });

    expect(createSessionOnComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "comment-9" }),
    );
    const commentBody = callGraphQL.mock.calls[0]?.[0].variables.input.body;
    expect(commentBody).toContain("**Agent handoff**");
    expect(commentBody).toContain("continuation packet");
    expect(result).toEqual({
      handoffSessionId: "session-9",
      handoffSessionUrl: "https://linear.app/session-9",
    });
  });

  it("falls back to a null handoffSessionUrl when the session record has none", async () => {
    callGraphQL.mockResolvedValue({
      commentCreate: { success: true, comment: { id: "comment-9" } },
    });
    createSessionOnComment.mockResolvedValue({ id: "session-9" });

    const result = await handoffTool.execute({
      issueId: "issue-uuid",
      brief: "continuation packet",
    });

    expect(result).toEqual({
      handoffSessionId: "session-9",
      handoffSessionUrl: null,
    });
  });
});

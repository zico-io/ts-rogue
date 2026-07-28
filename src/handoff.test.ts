import { beforeEach, describe, expect, it, vi } from "vitest";

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
  execute: (
    input: { issueId: string; brief: string },
    ctx: unknown,
  ) => Promise<
    | { handoffSessionId: string; handoffSessionUrl: string | null }
    | {
        alreadyLive: true;
        existingSessionId: string;
        existingSessionUrl: string | null;
      }
    | { checkpointed: true; checkpointCommentId: string }
  >;
};
const { createLinearComment } = await import("../agent/tools/handoff");

const toolCtx = (agentSessionId?: string) => ({
  session: {
    id: "eve-session-1",
    auth: {
      current:
        agentSessionId === undefined
          ? null
          : { attributes: { agent_session_id: agentSessionId } },
      initiator: null,
    },
  },
});

const RECENT = () => new Date(Date.now() - 60_000).toISOString();
const STALE = () => new Date(Date.now() - 60 * 60_000).toISOString();

const mockGraphQL = (input: {
  sessions?: readonly unknown[];
  commentId?: string;
}) => {
  const nodes = (input.sessions ?? []).map((session) =>
    session && typeof session === "object" && !("activities" in session)
      ? {
          ...session,
          activities: { nodes: [{ updatedAt: RECENT() }] },
        }
      : session,
  );
  callGraphQL.mockImplementation(async (call: { queryName: string }) =>
    call.queryName === "IssueLiveAgentSessions"
      ? { issue: { agentSessions: { nodes } } }
      : {
          commentCreate: {
            success: true,
            comment: { id: input.commentId ?? "comment-1" },
          },
        },
  );
};

const commentCreateCall = () =>
  callGraphQL.mock.calls.find(
    (call) => call[0]?.queryName === "CommentCreate",
  )?.[0];

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
    mockGraphQL({ commentId: "comment-9" });
    createSessionOnComment.mockResolvedValue({
      id: "session-9",
      url: "https://linear.app/session-9",
    });

    const result = await handoffTool.execute(
      {
        issueId: "issue-uuid",
        brief: "**Agent handoff**\n\ncontinuation packet",
      },
      toolCtx(),
    );

    expect(createSessionOnComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "comment-9" }),
    );
    const commentBody = commentCreateCall()?.variables.input.body;
    expect(commentBody).toBe("continuation packet");
    expect(result).toEqual({
      handoffSessionId: "session-9",
      handoffSessionUrl: "https://linear.app/session-9",
    });
  });

  it("falls back to a null handoffSessionUrl when the session record has none", async () => {
    mockGraphQL({ commentId: "comment-9" });
    createSessionOnComment.mockResolvedValue({ id: "session-9" });

    const result = await handoffTool.execute(
      { issueId: "issue-uuid", brief: "continuation packet" },
      toolCtx(),
    );

    expect(result).toEqual({
      handoffSessionId: "session-9",
      handoffSessionUrl: null,
    });
  });
});

describe("handoff duplicate-session guard", () => {
  beforeEach(() => {
    callGraphQL.mockReset();
    createSessionOnComment.mockReset();
  });

  it("refuses to create anything when the issue already has a live session", async () => {
    mockGraphQL({
      sessions: [
        {
          id: "session-live",
          status: "active",
          createdAt: "2026-07-25T10:00:00.000Z",
          url: "https://linear.app/session-live",
        },
      ],
    });

    const result = await handoffTool.execute(
      { issueId: "issue-uuid", brief: "packet" },
      toolCtx(),
    );

    expect(result).toEqual({
      alreadyLive: true,
      existingSessionId: "session-live",
      existingSessionUrl: "https://linear.app/session-live",
    });
    expect(commentCreateCall()).toBeUndefined();
    expect(createSessionOnComment).not.toHaveBeenCalled();
  });

  it("checkpoints in place when the only live session is the caller's own (self-continuation)", async () => {
    mockGraphQL({
      sessions: [
        {
          id: "session-self",
          status: "active",
          createdAt: "2026-07-25T10:00:00.000Z",
          url: "https://linear.app/session-self",
        },
      ],
      commentId: "comment-2",
    });

    const result = await handoffTool.execute(
      {
        issueId: "issue-uuid",
        brief: "**Agent handoff**\n\nPR #12 open; next: review",
      },
      toolCtx("session-self"),
    );

    // The same Linear Agent Session continues, so no second one is created; the
    // comment carries the marker naming this eve session for the channel to
    // retire, and the brief itself stays headerless human prose.
    expect(result).toEqual({
      checkpointed: true,
      checkpointCommentId: "comment-2",
    });
    expect(createSessionOnComment).not.toHaveBeenCalled();
    const commentBody = commentCreateCall()?.variables.input.body;
    expect(commentBody).toBe(
      "<!-- eve-checkpoint session=eve-session-1 -->\n\nContinuing this session with a fresh context window.\n\nPR #12 open; next: review",
    );
  });

  it("ignores sessions in terminal statuses", async () => {
    mockGraphQL({
      sessions: [
        { id: "s1", status: "complete", createdAt: "1", url: null },
        { id: "s2", status: "error", createdAt: "2", url: null },
        { id: "s3", status: "stale", createdAt: "3", url: null },
      ],
    });
    createSessionOnComment.mockResolvedValue({ id: "session-new" });

    const result = await handoffTool.execute(
      { issueId: "issue-uuid", brief: "packet" },
      toolCtx(),
    );

    expect(result).toMatchObject({ handoffSessionId: "session-new" });
  });

  it("fails open when the live-session query errors", async () => {
    callGraphQL.mockImplementation(async (call: { queryName: string }) => {
      if (call.queryName === "IssueLiveAgentSessions") {
        throw new Error("Linear is down");
      }
      return { commentCreate: { success: true, comment: { id: "comment-1" } } };
    });
    createSessionOnComment.mockResolvedValue({ id: "session-new" });

    const result = await handoffTool.execute(
      { issueId: "issue-uuid", brief: "packet" },
      toolCtx(),
    );

    expect(result).toMatchObject({ handoffSessionId: "session-new" });
  });

  it("creates a session when the only live-status session is stale (idle past the threshold)", async () => {
    mockGraphQL({
      sessions: [
        {
          id: "session-stalled",
          status: "active",
          createdAt: STALE(),
          url: "https://linear.app/session-stalled",

          activities: { nodes: [{ updatedAt: STALE() }] },
        },
      ],
    });
    createSessionOnComment.mockResolvedValue({ id: "session-new" });

    const result = await handoffTool.execute(
      { issueId: "issue-uuid", brief: "packet" },
      toolCtx(),
    );

    expect(result).toMatchObject({ handoffSessionId: "session-new" });
    expect(createSessionOnComment).toHaveBeenCalled();
  });
});

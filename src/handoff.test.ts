import { beforeEach, describe, expect, it, vi } from "vitest";

// Handoff pre-checks the issue for an already-live Agent Session (the
// one-live-session-per-issue invariant), then posts a Linear comment via the
// hand-rolled `commentCreate` mutation and anchors a fresh Agent Session to
// that comment. These mocks stand in for the eve runtime and Linear GraphQL
// transport so all three steps can be driven and asserted without a live
// session.
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
  >;
};
const { createLinearComment } = await import("../agent/tools/handoff");

// Dispatch-auth shape `defaultLinearAuth` produces for a Linear-initiated
// session: the caller's own Agent Session id rides in `attributes`.
const toolCtx = (agentSessionId?: string) => ({
  session: {
    auth: {
      current:
        agentSessionId === undefined
          ? null
          : { attributes: { agent_session_id: agentSessionId } },
      initiator: null,
    },
  },
});

// listLiveAgentSessions now excludes sessions idle past STALE_SESSION_MS, so a
// blocking mock session needs a recent "last active" signal to still count as
// live. Expressed relative to Date.now() so the tests are deterministic without
// pinning the clock; the STALE offset clears the 30-min threshold with margin.
const RECENT = () => new Date(Date.now() - 60_000).toISOString();
const STALE = () => new Date(Date.now() - 60 * 60_000).toISOString();

// Routes the two GraphQL queries the tool now issues: the live-session
// pre-check and the comment mutation. Sessions without their own `activities`
// are auto-stamped as recently active so they read as live.
const mockGraphQL = (input: {
  sessions?: readonly unknown[];
  commentId?: string;
}) => {
  const nodes = (input.sessions ?? []).map((session) =>
    session && typeof session === "object" && !("activities" in session)
      ? {
          ...(session as object),
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
      { issueId: "issue-uuid", brief: "continuation packet" },
      toolCtx(),
    );

    expect(createSessionOnComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "comment-9" }),
    );
    const commentBody = commentCreateCall()?.variables.input.body;
    expect(commentBody).toContain("**Agent handoff**");
    expect(commentBody).toContain("continuation packet");
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

  it("proceeds when the only live session is the caller's own (self-continuation)", async () => {
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
    createSessionOnComment.mockResolvedValue({ id: "session-next" });

    const result = await handoffTool.execute(
      { issueId: "issue-uuid", brief: "continuation packet" },
      toolCtx("session-self"),
    );

    expect(result).toMatchObject({ handoffSessionId: "session-next" });
    expect(createSessionOnComment).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "comment-2" }),
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
          // Explicit stale last-activity overrides the auto-stamp: silent well
          // past STALE_SESSION_MS, so it no longer blocks a fresh session.
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const { listLiveAgentSessionsMock } = vi.hoisted(() => ({
  listLiveAgentSessionsMock: vi.fn(async () => [] as unknown[]),
}));

vi.mock("./live-sessions", () => ({
  STALE_SESSION_MS: 30 * 60 * 1000,
  listLiveAgentSessions: listLiveAgentSessionsMock,
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentSessionOnComment: vi.fn(async () => ({
    id: "sess-comment",
  })),
  createLinearAgentSessionOnIssue: vi.fn(async () => ({ id: "sess-issue" })),
}));

const {
  duplicateSessionDeclineBody,
  findDuplicateSessionBlocker,
  initialSessionState,
  isStopSignal,
  resolveReceiveSession,
  stateFromAgentSession,
} = await import("./session");

const agentSession = {
  id: "sess-1",
  url: "https://linear.app/sess-1",
  commentId: null,
  issueId: "issue-1",
  issue: { id: "issue-1", identifier: "HAR-2", title: "t", url: "u" },
  organizationId: "org-1",
  sourceCommentId: null,
};

const live = (id: string, url: string | null = `https://linear.app/${id}`) => ({
  id,
  createdAt: "2026-07-25T10:00:00.000Z",
  url,
});

describe("initialSessionState", () => {
  it("starts with no session and an empty pending-action map", () => {
    expect(initialSessionState()).toMatchObject({
      agentSessionId: null,
      issueId: null,
      pendingActionsByCallId: {},
      pendingToolCallMessage: null,
    });
  });
});

describe("stateFromAgentSession", () => {
  it("maps a Linear agent session ref into channel state", () => {
    expect(stateFromAgentSession(agentSession)).toEqual({
      agentSessionId: "sess-1",
      agentSessionUrl: "https://linear.app/sess-1",
      commentId: null,
      issueId: "issue-1",
      issueIdentifier: "HAR-2",
      issueTitle: "t",
      issueUrl: "u",
      organizationId: "org-1",
      pendingActionsByCallId: {},
      pendingToolCallMessage: null,
      sourceCommentId: null,
    });
  });

  it("falls back to the nested issue id when issueId is absent", () => {
    expect(
      stateFromAgentSession({ id: "sess-2", issue: { id: "issue-9" } }),
    ).toMatchObject({ issueId: "issue-9" });
  });
});

describe("resolveReceiveSession", () => {
  it("returns the target session id directly when provided", async () => {
    await expect(
      resolveReceiveSession({ agentSessionId: "sess-3" }, {}),
    ).resolves.toEqual({ id: "sess-3" });
  });

  it("opens a session on an issue target", async () => {
    await expect(
      resolveReceiveSession({ issueId: "issue-1" }, {}),
    ).resolves.toEqual({ id: "sess-issue" });
  });

  it("opens a session on a comment target", async () => {
    await expect(
      resolveReceiveSession({ commentId: "comment-1" }, {}),
    ).resolves.toEqual({ id: "sess-comment" });
  });

  it("throws when the target has no usable identifier", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard for an invalid target
    await expect(resolveReceiveSession({} as any, {})).rejects.toThrow(
      "linearChannel().receive requires target.agentSessionId, issueId, or commentId.",
    );
  });
});

describe("isStopSignal (HAR-39)", () => {
  it("only fires for a prompted event carrying the stop signal", () => {
    expect(
      isStopSignal({ action: "prompted", agentActivity: { signal: "stop" } }),
    ).toBe(true);
    expect(
      isStopSignal({ action: "prompted", agentActivity: { signal: null } }),
    ).toBe(false);
    expect(isStopSignal({ action: "prompted" })).toBe(false);
    expect(
      isStopSignal({ action: "created", agentActivity: { signal: "stop" } }),
    ).toBe(false);
  });
});

describe("findDuplicateSessionBlocker", () => {
  beforeEach(() => {
    listLiveAgentSessionsMock.mockClear();
    listLiveAgentSessionsMock.mockResolvedValue([]);
  });

  const find = (session: Record<string, unknown> = {}) =>
    findDuplicateSessionBlocker({
      credentials: undefined,
      session: { ...agentSession, ...session },
    });

  it("returns the older live session that already owns the issue", async () => {
    listLiveAgentSessionsMock.mockResolvedValue([
      live("sess-0"),
      live("sess-1"),
    ]);

    await expect(find()).resolves.toMatchObject({ id: "sess-0" });
  });

  it("returns null when the session is the oldest live one", async () => {
    listLiveAgentSessionsMock.mockResolvedValue([
      live("sess-1"),
      live("sess-9"),
    ]);

    await expect(find()).resolves.toBeNull();
  });

  it("returns null when no other session is live", async () => {
    listLiveAgentSessionsMock.mockResolvedValue([live("sess-1")]);

    await expect(find()).resolves.toBeNull();
  });

  it("treats a session absent from the live list as blocked by any live session", async () => {
    listLiveAgentSessionsMock.mockResolvedValue([live("sess-7")]);

    await expect(find()).resolves.toMatchObject({ id: "sess-7" });
  });

  it("exempts agent-created sessions (handoff successors) without querying", async () => {
    await expect(
      find({ appUserId: "app-user-1", creatorId: "app-user-1" }),
    ).resolves.toBeNull();
    expect(listLiveAgentSessionsMock).not.toHaveBeenCalled();
  });

  it("fails open without querying when the session carries no issue id", async () => {
    await expect(find({ issue: null, issueId: null })).resolves.toBeNull();
    expect(listLiveAgentSessionsMock).not.toHaveBeenCalled();
  });

  it("fails open when the live-session query errors", async () => {
    listLiveAgentSessionsMock.mockRejectedValue(new Error("Linear is down"));

    await expect(find()).resolves.toBeNull();
  });
});

describe("duplicateSessionDeclineBody", () => {
  it("points the human at the live session's URL", () => {
    expect(duplicateSessionDeclineBody(live("sess-0"))).toContain(
      "https://linear.app/sess-0",
    );
  });

  it("omits the URL when the live session has none", () => {
    const body = duplicateSessionDeclineBody(live("sess-0", null));

    expect(body).toContain("already live on this issue.");
    expect(body).not.toContain("http");
  });
});

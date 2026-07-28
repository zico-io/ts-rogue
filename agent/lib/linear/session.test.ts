import { beforeEach, describe, expect, it, vi } from "vitest";

const { listLiveAgentSessionsMock } = vi.hoisted(() => ({
  listLiveAgentSessionsMock: vi.fn(async () => [] as unknown[]),
}));

vi.mock("./live-sessions", () => ({
  STALE_SESSION_MS: 30 * 60 * 1000,
  listLiveAgentSessions: listLiveAgentSessionsMock,
}));
const {
  duplicateSessionDeclineBody,
  findDuplicateSessionBlocker,
  isStopSignal,
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

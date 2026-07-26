import { describe, expect, it, vi } from "vitest";

const { callGraphQL } = vi.hoisted(() => ({ callGraphQL: vi.fn() }));

vi.mock("eve/channels/linear", () => ({
  callLinearGraphQL: (input: unknown) => callGraphQL(input),
}));

const { listLiveAgentSessions, STALE_SESSION_MS } = await import(
  "../agent/lib/live-sessions"
);

const NOW = Date.parse("2026-07-25T10:00:00.000Z");
const FRESH = "2026-07-25T09:50:00.000Z";
const STALE = "2026-07-25T09:00:00.000Z";

const list = (sessions: readonly unknown[]) => {
  callGraphQL.mockResolvedValue({
    issue: { agentSessions: { nodes: sessions } },
  });
  return listLiveAgentSessions({
    credentials: {} as never,
    issueId: "issue-uuid",
    now: NOW,
  });
};

describe("listLiveAgentSessions staleness", () => {
  it("keeps a live session whose most recent activity is fresh", async () => {
    const live = await list([
      {
        id: "s1",
        status: "active",
        createdAt: STALE,
        url: null,
        activities: { nodes: [{ updatedAt: FRESH }] },
      },
    ]);
    expect(live.map((s) => s.id)).toEqual(["s1"]);
  });

  it("excludes a live-status session silent past the threshold (the stall)", async () => {
    const live = await list([
      {
        id: "s1",
        status: "active",
        createdAt: STALE,
        url: null,
        activities: { nodes: [{ updatedAt: STALE }] },
      },
    ]);
    expect(live).toEqual([]);
  });

  it("falls back to createdAt when a session has no activities yet", async () => {
    const live = await list([
      { id: "fresh", status: "pending", createdAt: FRESH, url: null },
      { id: "old", status: "pending", createdAt: STALE, url: null },
    ]);
    expect(live.map((s) => s.id)).toEqual(["fresh"]);
  });

  it("keeps a session with an unparseable timestamp (fail-open)", async () => {
    const live = await list([
      {
        id: "s1",
        status: "active",
        createdAt: "not-a-date",
        url: null,
        activities: { nodes: [{ updatedAt: "also-not-a-date" }] },
      },
    ]);
    expect(live.map((s) => s.id)).toEqual(["s1"]);
  });

  it("still drops terminal-status sessions regardless of recency", async () => {
    const live = await list([
      {
        id: "done",
        status: "complete",
        createdAt: FRESH,
        url: null,
        activities: { nodes: [{ updatedAt: FRESH }] },
      },
    ]);
    expect(live).toEqual([]);
  });

  it("exposes a 30-minute threshold", () => {
    expect(STALE_SESSION_MS).toBe(30 * 60 * 1000);
  });
});

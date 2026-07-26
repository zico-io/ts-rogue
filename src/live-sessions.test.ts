import { describe, expect, it, vi } from "vitest";

// listLiveAgentSessions is the shared "which sessions still block a new one?"
// query behind both the webhook duplicate guard and the handoff pre-check. It
// filters Linear's agentSessions by live status AND by recency: a live-status
// session that has been silent past STALE_SESSION_MS is dead and must not
// block. This mock stands in for the Linear GraphQL transport so the recency
// logic can be driven with an injected clock.
const { callGraphQL } = vi.hoisted(() => ({ callGraphQL: vi.fn() }));

vi.mock("eve/channels/linear", () => ({
  callLinearGraphQL: (input: unknown) => callGraphQL(input),
}));

const { listLiveAgentSessions, STALE_SESSION_MS } = await import(
  "../agent/lib/live-sessions"
);

const NOW = Date.parse("2026-07-25T10:00:00.000Z");
const FRESH = "2026-07-25T09:50:00.000Z"; // 10 min ago - within threshold
const STALE = "2026-07-25T09:00:00.000Z"; // 60 min ago - past 30 min threshold

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
        createdAt: STALE, // old creation, but recent activity keeps it live
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

  it("excludes mirror sessions so they never block a handoff or the guard", async () => {
    const live = await list([
      { id: "real", status: "active", createdAt: FRESH, url: null },
      {
        id: "mirror",
        status: "active",
        createdAt: FRESH,
        url: null,
        externalLinks: [
          { label: "eve-subagent-mirror", url: "https://eve.internal/x" },
        ],
      },
    ]);
    expect(live.map((s) => s.id)).toEqual(["real"]);
  });

  it("exposes a 30-minute threshold", () => {
    expect(STALE_SESSION_MS).toBe(30 * 60 * 1000);
  });
});

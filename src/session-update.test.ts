import { beforeEach, describe, expect, it, vi } from "vitest";

// The session_update tool posts one durable `response` activity, then - for
// still-working statuses - chases it with an ephemeral "Working" action chip
// so Linear's derived session state lands back on `active` instead of
// `complete` while work (e.g. a delegated coding child) is still running.
// Mocks stand in for the eve runtime and Linear activity transport so both
// posts can be driven and asserted without a live session.
const { createActivity } = vi.hoisted(() => ({ createActivity: vi.fn() }));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: unknown) => createActivity(input),
}));
vi.mock("eve/tools", () => ({ defineTool: (def: unknown) => def }));
vi.mock("../agent/hooks/child-relay", () => ({ relayIssueId: () => "ENG-2" }));

const tool = (await import("../agent/tools/session_update"))
  .default as unknown as {
  execute: (
    input: { agentSessionId: string; message: string; status: string },
    ctx: unknown,
  ) => Promise<{ delivered: boolean }>;
};

const rootCtx = { session: { parent: null } };
const childCtx = { session: { parent: {} } };

const activities = () =>
  createActivity.mock.calls.map((call) => call[0]?.activity);

describe("session_update working chip", () => {
  beforeEach(() => {
    createActivity.mockReset();
    createActivity.mockResolvedValue({ id: "a", success: true });
  });

  it("posts the durable response then an ephemeral Working chip for progress", async () => {
    const result = await tool.execute(
      {
        agentSessionId: "sess-1",
        message: "Delegating now.",
        status: "progress",
      },
      rootCtx,
    );

    expect(result).toEqual({ delivered: true });
    expect(activities()).toEqual([
      {
        agentSessionId: "sess-1",
        content: {
          body: "**Progress**\n\nDelegating now.",
          type: "response",
        },
      },
      {
        agentSessionId: "sess-1",
        content: {
          type: "action",
          action: "Working",
          parameter: "Delegating now.",
        },
        ephemeral: true,
      },
    ]);
  });

  it("posts only the durable response for completed", async () => {
    await tool.execute(
      { agentSessionId: "sess-1", message: "Shipped.", status: "completed" },
      rootCtx,
    );

    expect(activities()).toHaveLength(1);
    expect(activities()[0]?.content.type).toBe("response");
  });

  it("chases a child's coerced completed (-> progress) with the chip too", async () => {
    // A child finishing means the root continues (verify, push, PR), so the
    // session must stay active.
    await tool.execute(
      { agentSessionId: "sess-1", message: "Child done.", status: "completed" },
      childCtx,
    );

    const [update, chip] = activities();
    expect(update?.content.body).toBe("**Progress**\n\n[ENG-2] Child done.");
    expect(chip).toMatchObject({
      content: { action: "Working", parameter: "[ENG-2] Child done." },
      ephemeral: true,
    });
  });

  it("fails open when the chip post rejects - the durable update already landed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    createActivity
      .mockResolvedValueOnce({ id: "a", success: true })
      .mockRejectedValueOnce(new Error("Linear hiccup"));

    const result = await tool.execute(
      { agentSessionId: "sess-1", message: "mid-work", status: "progress" },
      rootCtx,
    );

    expect(result).toEqual({ delivered: true });
    expect(createActivity).toHaveBeenCalledTimes(2);
  });

  it("still throws when the durable update itself fails", async () => {
    createActivity.mockRejectedValueOnce(new Error("Linear down"));

    await expect(
      tool.execute(
        { agentSessionId: "sess-1", message: "mid-work", status: "progress" },
        rootCtx,
      ),
    ).rejects.toThrow("Linear down");
    expect(createActivity).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

// The session_update tool is role-guarded: the root posts any of the three
// handoff statuses (blocked/review/completed); a delegated child may post
// only blocked (issue-prefixed), and review/completed from a child return a
// structured refusal without posting. This suite covers the refusal wiring
// under `pnpm check` - the delegation eval exercises it end-to-end but only
// runs under EVE_EVAL_MOCK_MODEL. Mock pattern of `src/handoff.test.ts`.
const { createActivity } = vi.hoisted(() => ({ createActivity: vi.fn() }));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: unknown) => createActivity(input),
}));
vi.mock("eve/tools", () => ({ defineTool: (def: unknown) => def }));
vi.mock("../agent/hooks/child-relay", () => ({ relayIssueId: () => "ROG-7" }));

const tool = (await import("../agent/tools/session_update"))
  .default as unknown as {
  execute: (
    input: { agentSessionId: string; message: string; status: string },
    ctx: unknown,
  ) => Promise<{ delivered: boolean; refused?: string }>;
};

const rootCtx = { session: { parent: null } };
const childCtx = { session: { parent: {} } };

describe("session_update role guard", () => {
  it("refuses completed from a child without posting anything", async () => {
    createActivity.mockReset();

    const result = await tool.execute(
      { agentSessionId: "sess-1", message: "all done", status: "completed" },
      childCtx,
    );

    expect(result.delivered).toBe(false);
    expect(result.refused).toContain("session owner");
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("posts a child's blocked update with the issue prefix", async () => {
    createActivity.mockReset();
    createActivity.mockResolvedValue({ id: "a", success: true });

    const result = await tool.execute(
      { agentSessionId: "sess-1", message: "stuck on auth", status: "blocked" },
      childCtx,
    );

    expect(result).toEqual({ delivered: true });
    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(createActivity.mock.calls[0]?.[0]?.activity).toEqual({
      agentSessionId: "sess-1",
      content: {
        body: "**Blocked**\n\n[ROG-7] stuck on auth",
        type: "response",
      },
    });
  });

  it("posts the root's completed update untouched", async () => {
    createActivity.mockReset();
    createActivity.mockResolvedValue({ id: "a", success: true });

    const result = await tool.execute(
      { agentSessionId: "sess-1", message: "Shipped.", status: "completed" },
      rootCtx,
    );

    expect(result).toEqual({ delivered: true });
    expect(createActivity.mock.calls[0]?.[0]?.activity.content.body).toBe(
      "**Completed**\n\nShipped.",
    );
  });
});

import { describe, expect, it, vi } from "vitest";

const { createActivity } = vi.hoisted(() => ({ createActivity: vi.fn() }));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: unknown) => createActivity(input),
}));
vi.mock("eve/tools", () => ({ defineTool: (def: unknown) => def }));

const tool = (await import("../agent/tools/session_update"))
  .default as unknown as {
  execute: (input: {
    agentSessionId: string;
    message: string;
    status: "blocked" | "review" | "completed";
  }) => Promise<{ delivered: boolean }>;
};

describe("session_update", () => {
  it("posts the update without a redundant status or Markdown header", async () => {
    createActivity.mockResolvedValue({ id: "a", success: true });

    await expect(
      tool.execute({
        agentSessionId: "sess-1",
        message: "## Evidence\n\n`pnpm check` passes.",
        status: "review",
      }),
    ).resolves.toEqual({ delivered: true });

    expect(createActivity).toHaveBeenCalledWith({
      api: undefined,
      credentials: {},
      activity: {
        agentSessionId: "sess-1",
        content: {
          body: "`pnpm check` passes.",
          type: "response",
        },
      },
    });
  });
});

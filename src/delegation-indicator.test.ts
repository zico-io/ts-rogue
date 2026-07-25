import { beforeEach, describe, expect, it, vi } from "vitest";

const { createActivity } = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: mock captures the Linear activity payload
  createActivity: vi.fn(async (_input: any) => ({})),
}));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: unknown) => createActivity(input),
}));
vi.mock("eve/hooks", () => ({ defineHook: (def: unknown) => def }));

const events =
  // biome-ignore lint/suspicious/noExplicitAny: driving mocked hook handlers in a test
  (await import("../agent/hooks/delegation-indicator")).default.events as any;

const { WORKING_INDICATOR } = await import(
  "../agent/hooks/delegation-indicator"
);

describe("delegation-indicator hook", () => {
  beforeEach(() => {
    createActivity.mockClear();
  });

  it("posts an ephemeral working indicator to the Linear session on delegation", async () => {
    await events["subagent.called"](
      { data: { childSessionId: "child-1" } },
      { channel: { continuationToken: "agent-session:sess-9" } },
    );
    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(createActivity.mock.calls[0]?.[0].activity).toEqual({
      agentSessionId: "sess-9",
      content: { body: WORKING_INDICATOR, type: "thought" },
      ephemeral: true,
    });
  });

  it("stays silent for sessions without a Linear agent session token", async () => {
    await events["subagent.called"](
      { data: {} },
      { channel: { continuationToken: "pull-request:7" } },
    );
    await events["subagent.called"]({ data: {} }, { channel: {} });
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("swallows Linear failures instead of failing the turn", async () => {
    createActivity.mockRejectedValueOnce(new Error("linear down"));
    await expect(
      events["subagent.called"](
        { data: {} },
        { channel: { continuationToken: "agent-session:sess-9" } },
      ),
    ).resolves.toBeUndefined();
  });
});

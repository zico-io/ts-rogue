import { beforeEach, describe, expect, it, vi } from "vitest";

// The hook fires on the root session's own stream while a `Workflow` step
// runs. These mocks stand in for the eve runtime scope so the handlers can
// be driven and their Linear posts asserted without a live session.
const { createActivity, stateBox } = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: mock captures the Linear activity payload
  createActivity: vi.fn(async (_input: any) => ({ id: "a", success: true })),
  stateBox: {
    value: {} as Record<string, { action: string; parameter: string }>,
  },
}));

type PendingCalls = typeof stateBox.value;

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: unknown) => createActivity(input),
}));
vi.mock("eve/hooks", () => ({ defineHook: (def: unknown) => def }));
vi.mock("eve/context", () => ({
  defineState: (_name: string, initial: () => PendingCalls) => {
    stateBox.value = initial();
    return {
      get: () => stateBox.value,
      update: (fn: (c: PendingCalls) => PendingCalls) => {
        stateBox.value = fn(stateBox.value);
      },
    };
  },
}));

const events =
  // biome-ignore lint/suspicious/noExplicitAny: driving mocked hook handlers in a test
  (await import("../agent/hooks/workflow-progress")).default.events as any;

const freshState = (): PendingCalls => ({});

const linearCtx = (continuationToken = "agent-session:sess-1") => ({
  session: {},
  channel: { continuationToken },
});

const nonLinearCtx = () => ({
  session: {},
  channel: {},
});

const contentOf = (call: number) =>
  createActivity.mock.calls[call]?.[0].activity.content;

const called = (input: {
  callId: string;
  sequence: number;
  name?: string;
}) => ({
  data: {
    callId: input.callId,
    childSessionId: `child-${input.callId}`,
    sessionId: "root",
    sequence: input.sequence,
    name: input.name ?? "agent",
    toolName: input.name ?? "agent",
    turnId: "turn-1",
    workflowId: "wf-1",
  },
});

const completed = (input: {
  callId: string;
  output: string;
  subagentName?: string;
}) => ({
  data: {
    callId: input.callId,
    output: input.output,
    subagentName: input.subagentName ?? "agent",
  },
});

describe("workflow-progress hook", () => {
  beforeEach(() => {
    createActivity.mockClear();
    stateBox.value = freshState();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("posts an ephemeral chip when a workflow call dispatches", async () => {
    await events["subagent.called"](
      called({ callId: "call_1", sequence: 0 }),
      linearCtx(),
    );

    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(createActivity.mock.calls[0]?.[0].activity.agentSessionId).toBe(
      "sess-1",
    );
    expect(createActivity.mock.calls[0]?.[0].activity.ephemeral).toBe(true);
    expect(contentOf(0)).toEqual({
      type: "action",
      action: "Agent",
      parameter: "Workflow call 1",
    });
  });

  it("posts a durable chip with the truncated result when a workflow call completes", async () => {
    await events["subagent.called"](
      called({ callId: "call_2", sequence: 1 }),
      linearCtx(),
    );
    await events["subagent.completed"](
      completed({ callId: "call_2", output: "found the answer" }),
      linearCtx(),
    );

    expect(createActivity).toHaveBeenCalledTimes(2);
    expect(
      createActivity.mock.calls[1]?.[0].activity.ephemeral,
    ).toBeUndefined();
    expect(contentOf(1)).toEqual({
      type: "action",
      action: "Agent",
      parameter: "Workflow call 2",
      result: "found the answer",
    });
  });

  it("labels each concurrent call by its own sequence and clears state once completed", async () => {
    await events["subagent.called"](
      called({ callId: "call_1", sequence: 0 }),
      linearCtx(),
    );
    await events["subagent.called"](
      called({ callId: "call_2", sequence: 1 }),
      linearCtx(),
    );
    await events["subagent.called"](
      called({ callId: "call_3", sequence: 2 }),
      linearCtx(),
    );
    expect(Object.keys(stateBox.value)).toEqual(["call_1", "call_2", "call_3"]);

    await events["subagent.completed"](
      completed({ callId: "call_2", output: "middle finished first" }),
      linearCtx(),
    );

    expect(contentOf(3)).toMatchObject({ parameter: "Workflow call 2" });
    expect(Object.keys(stateBox.value)).toEqual(["call_1", "call_3"]);
  });

  it("falls back to the subagent name when a completion has no matching dispatch", async () => {
    await events["subagent.completed"](
      completed({ callId: "unknown", output: "done", subagentName: "agent" }),
      linearCtx(),
    );

    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(contentOf(0)).toEqual({
      type: "action",
      action: "Agent",
      parameter: "Workflow call",
      result: "done",
    });
  });

  it("does nothing for a non-Linear continuation token (e.g. a merge-woken GitHub session)", async () => {
    await events["subagent.called"](
      called({ callId: "call_1", sequence: 0 }),
      nonLinearCtx(),
    );
    await events["subagent.completed"](
      completed({ callId: "call_1", output: "done" }),
      nonLinearCtx(),
    );

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("warns instead of failing the workflow step when a Linear post errors", async () => {
    createActivity.mockRejectedValueOnce(new Error("linear down"));
    await events["subagent.called"](
      called({ callId: "call_1", sequence: 0 }),
      linearCtx(),
    );

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("posting a Linear activity failed"),
      "linear down",
    );
  });

  it("truncates an oversized result", async () => {
    await events["subagent.called"](
      called({ callId: "call_1", sequence: 0 }),
      linearCtx(),
    );
    await events["subagent.completed"](
      completed({ callId: "call_1", output: "x".repeat(500) }),
      linearCtx(),
    );

    const { result } = contentOf(1);
    expect(result.length).toBeLessThanOrEqual(301); // 300 + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });
});

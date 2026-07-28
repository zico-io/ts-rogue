import type { LinearAgentActivityCreateInput } from "eve/channels/linear";
import type { HookContext, HookEvent } from "eve/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The hook fires on the root session's own stream while a `Workflow` step
// runs. These mocks stand in for the eve runtime scope so the handlers can
// be driven and their Linear posts asserted without a live session.
const { createActivity, stateBox } = vi.hoisted(() => ({
  createActivity: vi.fn(
    async (_input: { readonly activity: LinearAgentActivityCreateInput }) => ({
      id: "a",
      success: true,
    }),
  ),
  stateBox: {
    value: {} as Record<string, { action: string; parameter: string }>,
  },
}));

type PendingCalls = typeof stateBox.value;

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: {
    readonly activity: LinearAgentActivityCreateInput;
  }) => createActivity(input),
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

const hook = (await import("../agent/hooks/workflow-progress")).default;

const subagentCalled = (
  event: HookEvent<"subagent.called">,
  ctx: HookContext,
) => hook.events?.["subagent.called"]?.(event, ctx);

const subagentCompleted = (
  event: HookEvent<"subagent.completed">,
  ctx: HookContext,
) => hook.events?.["subagent.completed"]?.(event, ctx);

const freshState = (): PendingCalls => ({});

// The hook reads only `ctx.channel`; these stand in for a whole `HookContext`.
const hookCtx = (channel: HookContext["channel"]): HookContext =>
  ({ channel, session: {} }) as unknown as HookContext;

const linearCtx = (continuationToken = "agent-session:sess-1") =>
  hookCtx({ continuationToken, kind: "linear" });

// A channel with no out-of-band posting surface, e.g. a merge-woken GitHub
// session. The hook posts the same update; nothing shows.
const unpostableCtx = () =>
  hookCtx({ continuationToken: "issue:42", kind: "github" });

// A Linear session the hook cannot address, because the runtime handed it no
// continuation token.
const unaddressableCtx = () => hookCtx({ kind: "linear" });

const contentOf = (call: number) =>
  createActivity.mock.calls[call][0].activity.content;

/** The posted chip's result, which only an `action` activity carries. */
const resultOf = (call: number): string | undefined => {
  const content = contentOf(call);
  return content.type === "action" ? content.result : undefined;
};

const called = (input: {
  callId: string;
  sequence: number;
  name?: string;
}): HookEvent<"subagent.called"> => ({
  data: {
    callId: input.callId,
    childSessionId: `child-${input.callId}`,
    name: input.name ?? "agent",
    sequence: input.sequence,
    sessionId: "root",
    toolName: input.name ?? "agent",
    turnId: "turn-1",
    workflowId: "wf-1",
  },
  type: "subagent.called",
});

const completed = (input: {
  callId: string;
  output: string;
  subagentName?: string;
}): HookEvent<"subagent.completed"> => ({
  data: {
    callId: input.callId,
    output: input.output,
    subagentName: input.subagentName ?? "agent",
  },
  type: "subagent.completed",
});

describe("workflow-progress hook", () => {
  beforeEach(() => {
    createActivity.mockClear();
    stateBox.value = freshState();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("posts an ephemeral chip when a workflow call dispatches", async () => {
    await subagentCalled(
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
    await subagentCalled(
      called({ callId: "call_2", sequence: 1 }),
      linearCtx(),
    );
    await subagentCompleted(
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
    await subagentCalled(
      called({ callId: "call_1", sequence: 0 }),
      linearCtx(),
    );
    await subagentCalled(
      called({ callId: "call_2", sequence: 1 }),
      linearCtx(),
    );
    await subagentCalled(
      called({ callId: "call_3", sequence: 2 }),
      linearCtx(),
    );
    expect(Object.keys(stateBox.value)).toEqual(["call_1", "call_2", "call_3"]);

    await subagentCompleted(
      completed({ callId: "call_2", output: "middle finished first" }),
      linearCtx(),
    );

    expect(contentOf(3)).toMatchObject({ parameter: "Workflow call 2" });
    expect(Object.keys(stateBox.value)).toEqual(["call_1", "call_3"]);
  });

  it("falls back to the subagent name when a completion has no matching dispatch", async () => {
    await subagentCompleted(
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

  it("does nothing on a channel with no poster (e.g. a merge-woken GitHub session)", async () => {
    await subagentCalled(
      called({ callId: "call_1", sequence: 0 }),
      unpostableCtx(),
    );
    await subagentCompleted(
      completed({ callId: "call_1", output: "done" }),
      unpostableCtx(),
    );

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("does nothing without a continuation token to address the session", async () => {
    await subagentCalled(
      called({ callId: "call_1", sequence: 0 }),
      unaddressableCtx(),
    );

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("warns instead of failing the workflow step when a Linear post errors", async () => {
    createActivity.mockRejectedValueOnce(new Error("linear down"));
    await subagentCalled(
      called({ callId: "call_1", sequence: 0 }),
      linearCtx(),
    );

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("posting a Linear activity failed"),
      "linear down",
    );
  });

  it("truncates an oversized result", async () => {
    await subagentCalled(
      called({ callId: "call_1", sequence: 0 }),
      linearCtx(),
    );
    await subagentCompleted(
      completed({ callId: "call_1", output: "x".repeat(500) }),
      linearCtx(),
    );

    const result = resultOf(1);
    expect(result?.length).toBeLessThanOrEqual(300);
    expect(result?.endsWith("…")).toBe(true);
  });
});

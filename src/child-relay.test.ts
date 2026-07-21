import { beforeEach, describe, expect, it, vi } from "vitest";

// The hook fires inside the delegated child (a copy of the root agent). These
// mocks stand in for the eve runtime scope so the handlers can be driven and
// their Linear posts asserted without a live session.
const { createActivity, stateBox } = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: mock captures the Linear activity payload
  createActivity: vi.fn(async (_input: any) => ({})),
  stateBox: { value: { agentSessionId: null as string | null } },
}));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: unknown) => createActivity(input),
}));
vi.mock("eve/hooks", () => ({ defineHook: (def: unknown) => def }));
vi.mock("eve/context", () => ({
  defineState: (
    _name: string,
    initial: () => { agentSessionId: string | null },
  ) => {
    stateBox.value = initial();
    return {
      get: () => stateBox.value,
      update: (
        fn: (c: { agentSessionId: string | null }) => {
          agentSessionId: string | null;
        },
      ) => {
        stateBox.value = fn(stateBox.value);
      },
    };
  },
}));

const events =
  // biome-ignore lint/suspicious/noExplicitAny: driving mocked hook handlers in a test
  (await import("../agent/hooks/child-relay")).default.events as any;

const child = { session: { parent: { sessionId: "root", callId: "c1" } } };
const root = { session: {} };
const toolCall = (toolName: string, input: Record<string, unknown>) => ({
  data: { actions: [{ kind: "tool-call", toolName, input, callId: "x" }] },
});
const contentOf = (call: number) =>
  createActivity.mock.calls[call]?.[0].activity.content;

describe("child-relay hook", () => {
  beforeEach(() => {
    createActivity.mockClear();
    stateBox.value = { agentSessionId: null };
  });

  it("ignores root-session events (relays only inside a delegated child)", async () => {
    await events["message.received"](
      { data: { message: "agent_session_id: s1" } },
      root,
    );
    await events["actions.requested"](
      toolCall("edit_file", { path: "a" }),
      root,
    );
    await events["message.completed"]({ data: { message: "hi" } }, root);
    expect(createActivity).not.toHaveBeenCalled();
    expect(stateBox.value.agentSessionId).toBeNull();
  });

  it("relays child tool calls and narration once the session id is captured", async () => {
    await events["message.received"](
      {
        data: {
          message:
            "<linear_context>\nagent_session_id: sess-1\n</linear_context>",
        },
      },
      child,
    );
    await events["actions.requested"](
      toolCall("edit_file", { path: "src/x.ts" }),
      child,
    );
    await events["message.completed"](
      { data: { message: "  building the thing  " } },
      child,
    );

    expect(createActivity).toHaveBeenCalledTimes(2);
    expect(createActivity.mock.calls[0]?.[0].activity.agentSessionId).toBe(
      "sess-1",
    );
    expect(contentOf(0)).toEqual({
      type: "action",
      action: "Edit file",
      parameter: JSON.stringify({ path: "src/x.ts" }),
    });
    expect(contentOf(1)).toEqual({
      type: "thought",
      body: "building the thing",
    });
  });

  it("stays silent until the session id is known", async () => {
    await events["actions.requested"](
      toolCall("edit_file", { path: "a" }),
      child,
    );
    await events["message.completed"]({ data: { message: "working" } }, child);
    expect(createActivity).not.toHaveBeenCalled();
  });

  it("captures the id from a session_update call but does not double-post it", async () => {
    await events["actions.requested"](
      toolCall("session_update", {
        agentSessionId: "sess-2",
        message: "started",
      }),
      child,
    );
    expect(stateBox.value.agentSessionId).toBe("sess-2");
    expect(createActivity).not.toHaveBeenCalled(); // session_update posts its own activity
  });

  it("truncates an oversized tool-call parameter", async () => {
    stateBox.value = { agentSessionId: "sess-3" };
    await events["actions.requested"](
      toolCall("run", { cmd: "x".repeat(500) }),
      child,
    );
    const { parameter } = contentOf(0);
    expect(parameter.length).toBeLessThanOrEqual(301);
    expect(parameter.endsWith("…")).toBe(true);
  });
});

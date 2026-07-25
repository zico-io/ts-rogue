import { beforeEach, describe, expect, it, vi } from "vitest";

// The hook fires inside the delegated child (a copy of the root agent). These
// mocks stand in for the eve runtime scope so the handlers can be driven and
// their Linear posts asserted without a live session.
const { createActivity, stateBox } = vi.hoisted(() => ({
  // biome-ignore lint/suspicious/noExplicitAny: mock captures the Linear activity payload
  createActivity: vi.fn(async (_input: any) => ({})),
  stateBox: {
    value: {
      agentSessionId: null as string | null,
      issueId: null as string | null,
      sandboxChecked: false,
      warnedDark: false,
    },
  },
}));

type RelayState = typeof stateBox.value;

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({}),
}));
vi.mock("eve/channels/linear", () => ({
  createLinearAgentActivity: (input: unknown) => createActivity(input),
}));
vi.mock("eve/hooks", () => ({ defineHook: (def: unknown) => def }));
vi.mock("eve/context", () => ({
  defineState: (_name: string, initial: () => RelayState) => {
    stateBox.value = initial();
    return {
      get: () => stateBox.value,
      update: (fn: (c: RelayState) => RelayState) => {
        stateBox.value = fn(stateBox.value);
      },
    };
  },
}));

const { SESSION_ID_FILE } = await import("../agent/hooks/child-relay");
const events =
  // biome-ignore lint/suspicious/noExplicitAny: driving mocked hook handlers in a test
  (await import("../agent/hooks/child-relay")).default.events as any;

const freshState = (): RelayState => ({
  agentSessionId: null,
  issueId: null,
  sandboxChecked: false,
  warnedDark: false,
});

// Shared-sandbox stand-in for the session-id handoff file.
const makeSandbox = (fileContent = "") => ({
  run: vi.fn(async () => ({ exitCode: 0, stdout: fileContent, stderr: "" })),
  writeTextFile: vi.fn(async () => {}),
});

const makeChild = (sandbox = makeSandbox()) => ({
  session: { parent: { sessionId: "root", callId: "c1" } },
  channel: {},
  getSandbox: async () => sandbox,
});
const makeRoot = (
  sandbox = makeSandbox(),
  continuationToken: string | null = "agent-session:sess-9",
) => ({
  session: {},
  channel: { continuationToken: continuationToken ?? undefined },
  getSandbox: async () => sandbox,
});

const toolCall = (toolName: string, input: Record<string, unknown>) => ({
  data: { actions: [{ kind: "tool-call", toolName, input, callId: "x" }] },
});
const subagentCall = () => ({
  data: {
    actions: [
      { kind: "subagent-call", name: "agent", input: { message: "go" } },
    ],
  },
});
const contentOf = (call: number) =>
  createActivity.mock.calls[call]?.[0].activity.content;

describe("child-relay hook", () => {
  beforeEach(() => {
    createActivity.mockClear();
    stateBox.value = freshState();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("never posts from root-session events (relays only inside a delegated child)", async () => {
    const root = makeRoot();
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

  it("root writes the session-id handoff file when a batch delegates", async () => {
    const sandbox = makeSandbox();
    await events["actions.requested"](subagentCall(), makeRoot(sandbox));
    expect(sandbox.writeTextFile).toHaveBeenCalledWith({
      path: SESSION_ID_FILE,
      content: "sess-9",
    });
  });

  it("root skips the handoff for plain tool batches and non-Linear sessions", async () => {
    const sandbox = makeSandbox();
    await events["actions.requested"](
      toolCall("edit_file", { path: "a" }),
      makeRoot(sandbox),
    );
    // A merge-woken GitHub session has no Linear continuation token.
    await events["actions.requested"](subagentCall(), makeRoot(sandbox, null));
    expect(sandbox.writeTextFile).not.toHaveBeenCalled();
  });

  it("relays child tool calls and narration once the session id is captured", async () => {
    const child = makeChild();
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

  it("falls back to the handoff file when the delegation text lacks the id", async () => {
    const child = makeChild(makeSandbox("sess-7\n"));
    await events["message.received"](
      { data: { message: "issue: rog-9 - just the packet, no id" } },
      child,
    );
    await events["actions.requested"](
      toolCall("edit_file", { path: "src/x.ts" }),
      child,
    );
    expect(createActivity).toHaveBeenCalledTimes(1);
    expect(createActivity.mock.calls[0]?.[0].activity.agentSessionId).toBe(
      "sess-7",
    );
    expect(contentOf(0).action).toBe("[ROG-9] Edit file");
  });

  it("checks the handoff file once and warns once when the relay stays dark", async () => {
    const sandbox = makeSandbox("");
    const child = makeChild(sandbox);
    await events["actions.requested"](
      toolCall("edit_file", { path: "a" }),
      child,
    );
    await events["actions.requested"](
      toolCall("edit_file", { path: "b" }),
      child,
    );
    expect(createActivity).not.toHaveBeenCalled();
    expect(sandbox.run).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(console.warn)
        .mock.calls.filter(([m]) =>
          String(m).includes("no Linear agent session id"),
        ),
    ).toHaveLength(1);
  });

  it("posts working chips as ephemeral but keeps the final narration durable", async () => {
    stateBox.value = { ...freshState(), agentSessionId: "sess-5" };
    const child = makeChild();
    await events["actions.requested"](
      toolCall("edit_file", { path: "src/x.ts" }),
      child,
    );
    await events["reasoning.completed"](
      { data: { reasoning: "planning the edit" } },
      child,
    );
    await events["message.completed"](
      { data: { message: "handoff report" } },
      child,
    );

    // Action and reasoning chips are a live ticker: each ephemeral activity is
    // replaced by the next one, so the session shows one "currently doing"
    // slot. The child's completed message is the handoff record and stays.
    expect(createActivity.mock.calls[0]?.[0].activity.ephemeral).toBe(true);
    expect(createActivity.mock.calls[1]?.[0].activity.ephemeral).toBe(true);
    expect(
      createActivity.mock.calls[2]?.[0].activity.ephemeral,
    ).toBeUndefined();
  });

  it("prefixes relayed activity with the delegated issue once the packet names it", async () => {
    const child = makeChild();
    await events["message.received"](
      {
        data: {
          message:
            "issue: rog-12 — Tavern rework\nagent_session_id: sess-4\nbranch: nico/rog-12-tavern-rework",
        },
      },
      child,
    );
    await events["actions.requested"](
      toolCall("edit_file", { path: "src/x.ts" }),
      child,
    );
    await events["message.completed"]({ data: { message: "done" } }, child);

    expect(contentOf(0).action).toBe("[ROG-12] Edit file");
    expect(contentOf(1).body).toBe("[ROG-12] done");
  });

  it("captures the id from a session_update call but does not double-post it", async () => {
    const child = makeChild();
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

  it("warns instead of failing the child's turn when a Linear post errors", async () => {
    stateBox.value = { ...freshState(), agentSessionId: "sess-6" };
    createActivity.mockRejectedValueOnce(new Error("linear down"));
    await events["actions.requested"](
      toolCall("edit_file", { path: "a" }),
      makeChild(),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("posting a Linear activity failed"),
      "linear down",
    );
  });

  it("truncates an oversized tool-call parameter", async () => {
    stateBox.value = { ...freshState(), agentSessionId: "sess-3" };
    await events["actions.requested"](
      toolCall("run", { cmd: "x".repeat(500) }),
      makeChild(),
    );
    const { parameter } = contentOf(0);
    expect(parameter.length).toBeLessThanOrEqual(301);
    expect(parameter.endsWith("…")).toBe(true);
  });
});

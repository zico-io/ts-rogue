import type { ChannelEvents } from "eve/channels";
import type {
  LinearChannelContext,
  LinearEventContext,
  LinearHandle,
} from "eve/channels/linear";
import type { SessionContext } from "eve/tools";
import { describe, expect, it, vi } from "vitest";

const { advanceIssueStateMock } = vi.hoisted(() => ({
  advanceIssueStateMock: vi.fn(async () => {}),
}));

vi.mock("./issue-state", () => ({ advanceIssueState: advanceIssueStateMock }));
vi.mock("@vercel/connect/eve", () => ({
  connectGitHubCredentials: () => ({}),
  connectLinearCredentials: () => ({ accessToken: () => "connect-token" }),
}));

const { linearRenderer } = await import("./renderer");
const { AgentSession, sessionEvents } = await import("../session");
const { toolLabel } = await import("../tool-activity");

import type {
  ActionRequest,
  ActionResultData,
  InputRequest,
} from "../session-event";
import type { LinearStateWithPending } from "./session";

// The renderer posts through eve's `LinearHandle`; these record what it hands
// over. Eve's own delivery of an activity is exercised in
// `src/linear-channel.test.ts` against the real channel.
const createActivity = vi.fn(async (_content: unknown, _options?: unknown) => ({
  id: "a",
  success: true,
}));
const updateSession = vi.fn(async (_update: unknown) => ({ success: true }));

const events = sessionEvents(new AgentSession(linearRenderer));

const eventChannel = (
  state: Partial<LinearStateWithPending> = {},
  linear: Partial<LinearHandle> = {},
): LinearEventContext =>
  ({
    continuationToken: "agent-session:sess-1",
    linear: {
      agentSessionId: state.agentSessionId ?? "",
      createActivity,
      updateSession,
      ...linear,
    },
    setContinuationToken: vi.fn(),
    state,
  }) as unknown as LinearEventContext;

/** Everything the renderer handed to the handle, flattened into eve's own shape. */
const postedActivities = (): {
  content: Record<string, unknown>;
  ephemeral?: boolean;
  signal?: string;
  signalMetadata?: Record<string, unknown>;
}[] =>
  createActivity.mock.calls.map((call) => ({
    content: call[0] as Record<string, unknown>,
    ...(call[1] as Record<string, unknown> | undefined),
  }));

type EventDataOf<K extends keyof ChannelEvents<LinearChannelContext>> =
  Parameters<NonNullable<ChannelEvents<LinearChannelContext>[K]>>[0];

type MessageCompletedData = EventDataOf<"message.completed">;
type AuthorizationRequiredData = EventDataOf<"authorization.required">;
type AuthorizationCompletedData = EventDataOf<"authorization.completed">;

/** Every event payload carries these; no assertion here reads them. */
const turnMeta = { sequence: 0, stepIndex: 0, turnId: "turn-1" };

const bashAction = {
  callId: "c1",
  input: { command: "git status" },
  kind: "tool-call",
  toolName: "bash",
} satisfies ActionRequest;

const subagentCall = {
  callId: "c1",
  description: "Delegate a focused subtask to a fresh copy of yourself.",
  input: { message: "" },
  kind: "subagent-call",
  name: "agent",
  nodeId: "n1",
  subagentName: "agent",
} satisfies ActionRequest;

const sessionCtx = {} as unknown as SessionContext;

describe("actions.requested ephemeral render", () => {
  const postAction = async (action: ActionRequest) => {
    createActivity.mockClear();
    await events["actions.requested"]?.(
      { ...turnMeta, actions: [action] },
      eventChannel({ agentSessionId: "sess-1", pendingToolCallMessage: null }),
      sessionCtx,
    );
    return postedActivities()[0];
  };

  it("labels a subagent-call with the delegation packet's lead line, not the static tool description", async () => {
    const activity = await postAction({
      ...subagentCall,
      input: {
        message: "issue: ROG-65 - Add depth to the overworld\nscope: ...",
      },
    });
    expect(activity?.content).toEqual({
      action: "subagent-call",
      parameter: "issue: ROG-65 - Add depth to the overworld",
      type: "action",
    });
    expect(activity?.ephemeral).toBe(true);
  });

  it("falls back to the description when a subagent-call has no usable message", async () => {
    const activity = await postAction({
      ...subagentCall,
      input: { message: "   \n  " },
    });
    expect(activity?.content).toMatchObject({
      parameter: "Delegate a focused subtask to a fresh copy of yourself.",
    });
  });

  it("renders a plain tool call as a humanized label and readable parameter, not a JSON blob", async () => {
    const activity = await postAction(bashAction);
    expect(activity?.content).toEqual({
      action: "Bash",
      parameter: "git status",
      type: "action",
    });
  });
});

describe("actions.requested prose durability (HAR-68)", () => {
  const fireActionsRequested = async (
    actions: readonly ActionRequest[],
    pendingToolCallMessage: string | null,
  ) => {
    createActivity.mockClear();
    const state: Partial<LinearStateWithPending> = {
      agentSessionId: "sess-1",
      pendingToolCallMessage,
    };
    await events["actions.requested"]?.(
      { ...turnMeta, actions },
      eventChannel(state),
      sessionCtx,
    );
    return { calls: postedActivities(), state };
  };

  it("posts prose buffered ahead of a tool call as a durable thought, not an ephemeral one", async () => {
    const { calls } = await fireActionsRequested(
      [bashAction],
      "Let me check the current git status.",
    );
    expect(calls[0]).toMatchObject({
      content: {
        body: "Let me check the current git status.",
        type: "thought",
      },
    });
    expect(calls[0]?.ephemeral).not.toBe(true);
  });

  it("still posts the ephemeral action chip for the tool call that followed the prose", async () => {
    const { calls, state } = await fireActionsRequested(
      [bashAction],
      "Let me check the current git status.",
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      content: { action: "Bash", parameter: "git status", type: "action" },
      ephemeral: true,
    });
    expect(state.pendingActionsByCallId).toMatchObject({
      c1: { action: "Bash", parameter: "git status" },
    });
  });

  it("posts only the ephemeral action chip when there is no buffered prose", async () => {
    const { calls } = await fireActionsRequested([bashAction], null);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.content).toMatchObject({ type: "action" });
  });
});

describe("message.completed narration buffering (HAR-78)", () => {
  const fireMessageCompleted = async (
    data: Pick<MessageCompletedData, "finishReason" | "message">,
  ) => {
    const state: Partial<LinearStateWithPending> = {
      agentSessionId: "sess-1",
      pendingToolCallMessage: null,
    };
    await events["message.completed"]?.(
      { ...turnMeta, ...data },
      eventChannel(state),
      sessionCtx,
    );
    return state;
  };

  it("buffers the full multi-line narration ahead of a tool call, not just its first line", async () => {
    const proposal = [
      'Create the "Skill Trees" project with these 5 sequenced tickets:',
      "1. Skill tree data model",
      "2. Skill points & node state",
      "3. Skill tree UI",
      "4. Battle skill menu",
      "5. Starter trees for Warrior/Rogue/Wizard",
    ].join("\n");

    const state = await fireMessageCompleted({
      message: proposal,
      finishReason: "tool-calls",
    });

    expect(state.pendingToolCallMessage).toBe(proposal);
  });

  it("clears the buffer and posts nothing when the tool-call narration is empty", async () => {
    const state = await fireMessageCompleted({
      message: null,
      finishReason: "tool-calls",
    });

    expect(state.pendingToolCallMessage).toBeNull();
  });

  it("still posts a terminal reply in full and clears the buffer", async () => {
    createActivity.mockClear();
    const state = await fireMessageCompleted({
      message: "Done. Five tickets created.",
      finishReason: "stop",
    });

    expect(state.pendingToolCallMessage).toBeNull();
    const activity = postedActivities()[0];
    expect(activity?.content).toMatchObject({
      body: "Done. Five tickets created.",
      type: "response",
    });
  });
});

describe("ask_question confirmation gate stays self-contained (HAR-78)", () => {
  it("keeps the full proposal visible ahead of a terse ask_question prompt, in order", async () => {
    createActivity.mockClear();

    const proposal = [
      'Create the "Skill Trees" project with these 5 sequenced tickets:',
      "1. Skill tree data model",
      "2. Skill points & node state",
      "3. Skill tree UI",
      "4. Battle skill menu",
      "5. Starter trees for Warrior/Rogue/Wizard",
    ].join("\n");
    const askQuestionAction = {
      ...bashAction,
      input: { prompt: "Create it as described?" },
      toolName: "ask_question",
    } satisfies ActionRequest;
    const state: Partial<LinearStateWithPending> = {
      agentSessionId: "sess-1",
      pendingToolCallMessage: null,
    };

    // The model narrates the full proposal, then calls `ask_question` with
    // only a short recap - the same shape as the reported ENG-26 session.
    await events["message.completed"]?.(
      { ...turnMeta, finishReason: "tool-calls", message: proposal },
      eventChannel(state),
      sessionCtx,
    );
    await events["actions.requested"]?.(
      { ...turnMeta, actions: [askQuestionAction] },
      eventChannel(state),
      sessionCtx,
    );
    await events["input.requested"]?.(
      {
        ...turnMeta,
        requests: [
          {
            action: askQuestionAction,
            options: [{ id: "approve", label: "Yes, create it as described" }],
            prompt: "Create it as described?",
            requestId: "req-1",
          },
        ],
      },
      eventChannel(state),
      sessionCtx,
    );

    const posted = postedActivities().map((activity) => activity.content);

    // The full ticket-by-ticket proposal must be posted as its own durable
    // activity before the terse elicitation - Linear folds narration into a
    // preceding tool call's collapsed activity, so the elicitation prompt
    // alone is not enough for a reviewer to see what they are approving.
    const thoughtIndex = posted.findIndex(
      (content) => content.type === "thought" && content.body === proposal,
    );
    const elicitationIndex = posted.findIndex(
      (content) => content.type === "elicitation",
    );
    expect(thoughtIndex).toBeGreaterThanOrEqual(0);
    expect(elicitationIndex).toBeGreaterThan(thoughtIndex);
  });
});

describe("input.requested elicitation (HAR-17)", () => {
  it("posts a clean elicitation body with Linear's native select signal, not a hidden tracking marker", async () => {
    createActivity.mockClear();
    const requests: readonly InputRequest[] = [
      {
        action: bashAction,
        options: [
          { id: "approve", label: "Approve" },
          { id: "revise", label: "Revise" },
        ],
        prompt: "Approve this breakdown?",
        requestId: "req-1",
      },
    ];

    await events["input.requested"]?.(
      { ...turnMeta, requests },
      eventChannel({ agentSessionId: "sess-1" }),
      sessionCtx,
    );

    const activity = postedActivities()[0];
    expect(activity).toMatchObject({
      content: {
        body: "Approve this breakdown?\n\n1. Approve\n2. Revise",
        type: "elicitation",
      },
      signal: "select",
      signalMetadata: {
        options: [
          { label: "Approve", value: "approve" },
          { label: "Revise", value: "revise" },
        ],
      },
    });
    expect((activity?.content as { body?: string })?.body).not.toMatch(
      /eve-input/,
    );
  });
});

describe("action.result plan sync", () => {
  const postActionResult = async (
    data: Pick<ActionResultData, "result" | "status">,
  ) => {
    updateSession.mockClear();
    await events["action.result"]?.(
      { ...turnMeta, ...data },
      eventChannel({ agentSessionId: "sess-1" }),
      sessionCtx,
    );
    return updateSession.mock.calls[0]?.[0];
  };

  it("pushes the todo tool's list into the session's Linear plan", async () => {
    const call = await postActionResult({
      status: "completed",
      result: {
        callId: "c1",
        kind: "tool-result",
        output: {
          todos: [
            { content: "Ship it", priority: "high", status: "in_progress" },
          ],
        },
        toolName: "todo",
      },
    });
    expect(call).toMatchObject({
      plan: [{ content: "Ship it", status: "inProgress" }],
    });
  });

  it("never touches the Linear plan when the result carries none", async () => {
    await postActionResult({
      status: "completed",
      result: {
        callId: "c1",
        kind: "tool-result",
        output: {},
        toolName: "bash",
      },
    });
    expect(updateSession).not.toHaveBeenCalled();
  });
});

describe("action.result durable chip promotion (HAR-45, preserved through HAR-68)", () => {
  const fireActionResult = async (
    data: Pick<ActionResultData, "error" | "result" | "status">,
    pendingActionsByCallId: LinearStateWithPending["pendingActionsByCallId"] = {},
  ) => {
    createActivity.mockClear();
    await events["action.result"]?.(
      { ...turnMeta, ...data },
      eventChannel(
        { agentSessionId: "sess-1", pendingActionsByCallId },
        { updateSession: vi.fn() },
      ),
      sessionCtx,
    );
  };

  it("posts a durable action with the stashed action, parameter, and result when a tracked tool-call completes", async () => {
    await fireActionResult(
      {
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "c1",
          toolName: "bash",
          output: { stdout: "hello" },
        },
      },
      { c1: { action: "bash", parameter: '{"command":"echo hello"}' } },
    );

    expect(createActivity).toHaveBeenCalledTimes(1);
    const activity = postedActivities()[0];
    expect(activity?.ephemeral).toBeUndefined();
    expect(activity?.content).toEqual({
      type: "action",
      action: "bash",
      parameter: '{"command":"echo hello"}',
      // The stashed action/parameter are reused verbatim; only the result is
      // now a readable summary instead of raw JSON (bash output has no exitCode
      // here, so it reads as "done" plus the stdout line count).
      result: "✓ done · 1 line",
    });
  });

  it("posts nothing for an untracked callId (no prior actions.requested stash)", async () => {
    await fireActionResult(
      {
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "unknown",
          toolName: "bash",
          output: { stdout: "ok" },
        },
      },
      { c1: { action: "other", parameter: "x" } },
    );

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("uses error.message as the result when the tool call failed", async () => {
    await fireActionResult(
      {
        status: "failed",
        result: {
          kind: "tool-result",
          callId: "c2",
          toolName: "bash",
          isError: true,
          output: {},
        },
        error: { code: "TOOL_ERROR", message: "Command not found" },
      },
      { c2: { action: "bash", parameter: '{"command":"invalid"}' } },
    );

    expect(createActivity).toHaveBeenCalledTimes(1);
    const content = postedActivities()[0].content as Record<string, unknown>;
    expect(content.result).toBe("Command not found");
  });

  it("posts a long fenced result with the fence still closed and within the activity cap", async () => {
    const stderr = Array.from(
      { length: 60 },
      (_, i) => `line ${i} of failing output`,
    ).join("\n");
    await fireActionResult(
      {
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "c9",
          toolName: "bash",
          output: { exitCode: 1, stdout: "", stderr },
        },
      },
      { c9: { action: "bash", parameter: "bash script.sh" } },
    );

    const content = postedActivities()[0].content as Record<string, string>;
    // Truncating in lib and again here used to cut the closing fence back off,
    // so Linear rendered the rest of the session as a code block.
    expect((content.result.match(/```/g) ?? []).length % 2).toBe(0);
    expect(content.result.length).toBeLessThanOrEqual(300);
  });

  it("consumes the pending entry so a second action.result for the same callId posts nothing", async () => {
    const doneOnC3 = {
      ...turnMeta,
      result: {
        callId: "c3",
        kind: "tool-result",
        output: { stdout: "done" },
        toolName: "bash",
      },
      status: "completed",
    } satisfies ActionResultData;

    createActivity.mockClear();
    await events["action.result"]?.(
      doneOnC3,
      eventChannel(
        {
          agentSessionId: "sess-1",
          pendingActionsByCallId: {
            c3: { action: "bash", parameter: '{"cmd":"test"}' },
          },
        },
        { updateSession: vi.fn() },
      ),
      sessionCtx,
    );

    expect(createActivity).toHaveBeenCalledTimes(1);

    await events["action.result"]?.(
      doneOnC3,
      eventChannel(
        { agentSessionId: "sess-1", pendingActionsByCallId: {} },
        { updateSession: vi.fn() },
      ),
      sessionCtx,
    );

    expect(createActivity).toHaveBeenCalledTimes(1);
  });

  it("promotes a tracked subagent-call to durable on subagent-result", async () => {
    await fireActionResult(
      {
        status: "completed",
        result: {
          kind: "subagent-result",
          callId: "sub-c1",
          subagentName: "coder",
          output: { summary: "Implemented all changes" },
        },
      },
      {
        "sub-c1": {
          action: "subagent-call",
          parameter: "issue: HAR-48 - Add durable subagent_calls action",
        },
      },
    );

    expect(createActivity).toHaveBeenCalledTimes(1);
    const activity = postedActivities()[0];
    expect(activity?.ephemeral).toBeUndefined();
    expect(activity?.content).toEqual({
      type: "action",
      action: "subagent-call",
      parameter: "issue: HAR-48 - Add durable subagent_calls action",
      result: JSON.stringify({ summary: "Implemented all changes" }),
    });
  });

  it("promotes a remote-agent-call request followed by subagent-result to durable", async () => {
    await fireActionResult(
      {
        status: "completed",
        result: {
          kind: "subagent-result",
          callId: "remote-c1",
          subagentName: "scout",
          output: { notes: "Found 3 issues" },
        },
      },
      {
        "remote-c1": {
          action: "remote-agent-call",
          parameter: "issue: HAR-47 - Scout the codebase",
        },
      },
    );

    expect(createActivity).toHaveBeenCalledTimes(1);
    const content = postedActivities()[0].content as Record<string, unknown>;
    expect(content.action).toBe("remote-agent-call");
    expect(content.parameter).toBe("issue: HAR-47 - Scout the codebase");
    expect(content.result).toBe(JSON.stringify({ notes: "Found 3 issues" }));
  });

  it("posts nothing for an untracked callId on a subagent-result", async () => {
    await fireActionResult(
      {
        status: "completed",
        result: {
          kind: "subagent-result",
          callId: "unknown-sub",
          subagentName: "coder",
          output: { summary: "Done" },
        },
      },
      { "sub-c1": { action: "subagent-call", parameter: "real work" } },
    );

    expect(createActivity).not.toHaveBeenCalled();
  });

  it("uses error.message as the result when a subagent call failed", async () => {
    await fireActionResult(
      {
        status: "failed",
        result: {
          kind: "subagent-result",
          callId: "sub-c2",
          subagentName: "coder",
          output: {},
        },
        error: {
          code: "SUBAGENT_ERROR",
          message: "The subagent encountered an error",
        },
      },
      {
        "sub-c2": {
          action: "subagent-call",
          parameter: "issue: HAR-48 - Add durable subagent_calls action",
        },
      },
    );

    expect(createActivity).toHaveBeenCalledTimes(1);
    const content = postedActivities()[0].content as Record<string, unknown>;
    expect(content.result).toBe("The subagent encountered an error");
  });
});

describe("authorization events surface the OAuth challenge", () => {
  const linearUserAuth = {
    attributes: {},
    authenticator: "linear-agent-webhook",
    issuer: "linear:org-1",
    principalId: "linear:user-1",
    principalType: "user",
    subject: "user-1",
  };
  // The handlers read only `session.auth.current`, not a whole SessionContext.
  const authCtx = (current: typeof linearUserAuth | null): SessionContext =>
    ({ session: { auth: { current } } }) as unknown as SessionContext;
  const ctx = authCtx(linearUserAuth);

  const fireAuthorizationRequired = (
    data: Omit<AuthorizationRequiredData, keyof typeof turnMeta>,
    eventCtx: SessionContext = ctx,
  ) =>
    events["authorization.required"]?.(
      { ...turnMeta, ...data },
      eventChannel({ agentSessionId: "sess-1" }),
      eventCtx,
    );

  const fireAuthorizationCompleted = (
    data: Omit<AuthorizationCompletedData, keyof typeof turnMeta>,
  ) =>
    events["authorization.completed"]?.(
      { ...turnMeta, ...data },
      eventChannel({ agentSessionId: "sess-1" }),
      ctx,
    );

  const lastActivity = () => postedActivities().at(-1);

  it("posts an elicitation with Linear's native auth signal and the challenge URL", async () => {
    createActivity.mockClear();
    await fireAuthorizationRequired({
      authorization: {
        displayName: "Linear MCP",
        url: "https://example.com/oauth",
      },
      description: "Authorize the linear connection",
      name: "linear",
    });
    expect(postedActivities().at(-1)).toMatchObject({
      content: {
        body: "I need Linear MCP connected before I can continue.",
        type: "elicitation",
      },
      signal: "auth",
      signalMetadata: {
        providerName: "Linear MCP",
        url: "https://example.com/oauth",
        userId: "user-1",
      },
    });
    expect(postedActivities().at(-1)?.ephemeral).not.toBe(true);
  });

  it("title-cases the connection name and omits userId for a non-Linear principal", async () => {
    createActivity.mockClear();
    await fireAuthorizationRequired(
      {
        authorization: { url: "https://example.com/oauth" },
        description: "Authorize the vercel connection",
        name: "vercel",
      },
      authCtx(null),
    );
    const activity = postedActivities().at(-1);
    expect(activity?.signalMetadata).toEqual({
      providerName: "Vercel",
      url: "https://example.com/oauth",
    });
  });

  it("falls back to a plain elicitation with instructions when the challenge has no URL", async () => {
    createActivity.mockClear();
    await fireAuthorizationRequired({
      authorization: {
        instructions: "Approve the sign-in request on your phone.",
        userCode: "ABCD-1234",
      },
      description: "Authorize the linear connection",
      name: "linear",
    });
    const activity = postedActivities().at(-1);
    expect(activity?.signal).toBeUndefined();
    expect(activity?.content).toMatchObject({ type: "elicitation" });
    const body = (activity?.content as { body?: string })?.body ?? "";
    expect(body).toContain("Approve the sign-in request on your phone.");
    expect(body).toContain("Code: `ABCD-1234`");
  });

  it("posts an ephemeral resuming thought once authorization completes", async () => {
    createActivity.mockClear();
    await fireAuthorizationCompleted({
      authorization: { displayName: "Linear MCP" },
      name: "linear",
      outcome: "authorized",
    });
    expect(postedActivities().at(-1)).toMatchObject({
      content: { body: "Connected to Linear MCP. Resuming.", type: "thought" },
      ephemeral: true,
    });
  });

  it("reports a non-authorized outcome durably", async () => {
    createActivity.mockClear();
    await fireAuthorizationCompleted({
      name: "linear",
      outcome: "timed-out",
      reason: "challenge expired",
    });
    expect(postedActivities().at(-1)).toMatchObject({
      content: {
        body: "Authorization for Linear timed out: challenge expired",
        type: "thought",
      },
    });
    expect(postedActivities().at(-1)?.ephemeral).not.toBe(true);
  });
});

describe("issue lifecycle sync on session failure", () => {
  const sessionFailure = {
    code: "unrecoverable",
    details: {},
    message: "boom",
    sessionId: "sess-1",
  };
  const turnFailure = {
    ...turnMeta,
    code: "turn_failed",
    details: {},
    message: "boom",
  };
  const channelCtx = (issueId: string | null) =>
    eventChannel({
      agentSessionId: "sess-1",
      issueId,
      pendingToolCallMessage: null,
    });

  it("moves the issue to Blocked on session.failed", async () => {
    advanceIssueStateMock.mockClear();
    await events["session.failed"]?.(sessionFailure, channelCtx("issue-1"));

    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueRef: "issue-1", target: "blocked" }),
    );
  });

  it("skips the sync when the failed session has no issue", async () => {
    advanceIssueStateMock.mockClear();
    await events["session.failed"]?.(sessionFailure, channelCtx(null));

    expect(advanceIssueStateMock).not.toHaveBeenCalled();
  });

  it("never syncs on turn.failed (recoverable)", async () => {
    advanceIssueStateMock.mockClear();
    await events["turn.failed"]?.(
      turnFailure,
      channelCtx("issue-1"),
      sessionCtx,
    );

    expect(advanceIssueStateMock).not.toHaveBeenCalled();
  });
});

import type {
  ChannelDefinition,
  ChannelEvents,
  HttpRouteDefinition,
  RouteHandlerArgs,
} from "eve/channels";
import type {
  LinearChannelContext,
  LinearChannelState,
  LinearEventContext,
  LinearHandle,
  LinearInstrumentationMetadata,
  LinearReceiveTarget,
} from "eve/channels/linear";
import type { SessionContext } from "eve/tools";
import { describe, expect, it, vi } from "vitest";

import type { LinearStateWithPending } from "../agent/lib/linear/session";
import type {
  ActionRequest,
  ActionResultData,
  InputRequest,
} from "../agent/lib/session-event";

const { order, cancelMock, sendMock, waitUntilTasks, webhookVerifier } =
  vi.hoisted(() => ({
    order: [] as string[],
    cancelMock: vi.fn(async () => {
      order.push("cancel");
      return { status: "accepted" as const };
    }),
    sendMock: vi.fn(async () => {
      order.push("send");
      return {};
    }),
    waitUntilTasks: [] as Promise<unknown>[],

    webhookVerifier: vi.fn(async () => true),
  }));

const { advanceIssueStateMock } = vi.hoisted(() => ({
  advanceIssueStateMock: vi.fn(async () => {
    order.push("advance");
  }),
}));

vi.mock("../agent/lib/linear/issue-state", () => ({
  advanceIssueState: advanceIssueStateMock,
}));

vi.mock("@vercel/connect/eve", () => ({
  connectGitHubCredentials: () => ({}),
  connectLinearCredentials: () => ({
    accessToken: () => "connect-token",
    webhookVerifier,
  }),
}));

vi.mock("eve/channels", () => ({
  defineChannel: (definition: unknown) => definition,
  POST: (path: string, handler: unknown) => ({ method: "POST", path, handler }),
}));

vi.mock("eve/channels/linear", () => ({
  callLinearGraphQL: vi.fn(async () => ({})),
  createLinearAgentActivity: vi.fn(async () => ({ id: "a", success: true })),
  createLinearAgentSessionOnComment: vi.fn(async () => ({ id: "sess-new" })),
  createLinearAgentSessionOnIssue: vi.fn(async () => ({ id: "sess-new" })),
  defaultOnAgentSession: vi.fn(() => ({ auth: null })),
  formatLinearContextBlock: vi.fn(() => "context-block"),
  LINEAR_CHANNEL_DEFAULT_ROUTE: "/eve/v1/linear",
  linearContinuationToken: vi.fn(
    (agentSessionId: string) => `linear:${agentSessionId}`,
  ),
  linearInputRequestSignal: vi.fn(() => ({})),
  listLinearAgentSessionActivities: vi.fn(async () => []),
  messageFromLinearAgentSessionEvent: vi.fn(() => "message"),
  parseLinearWebhookEvent: vi.fn(({ body }: { body: string }) =>
    JSON.parse(body),
  ),
  renderLinearInputRequests: vi.fn(() => "elicitation"),
  signLinearWebhookBody: vi.fn(
    () => "unused-because-webhookVerifier-bypasses-it",
  ),
  updateLinearAgentSession: vi.fn(async () => ({ success: true })),
}));

// The decisions these handlers render live in agent/lib, tested beside their
// modules - agent/lib/{turn-report,agent-plan,authorization,session,webhook}
// .test.ts and agent/lib/linear/. What is left here is the adapter's own job:
// what gets posted, whether it is ephemeral, and in what order relative to
// `cancel`/`send`. It stays in src/ because eve's discovery rejects a
// `*.test.ts` under agent/channels/ (see agent/AGENTS.md).
const { default: channel } = await import("../agent/channels/linear");
const {
  callLinearGraphQL,
  createLinearAgentActivity,
  linearInputRequestSignal,
  messageFromLinearAgentSessionEvent,
  renderLinearInputRequests,
  updateLinearAgentSession,
} = await import("eve/channels/linear");

// `defineChannel` is mocked identity-style above, so `channel` is really the
// definition it was handed - `events` and a concrete route, neither of which the
// opaque `Channel` type exposes.
const definition = channel as unknown as ChannelDefinition<
  LinearChannelState,
  LinearChannelContext,
  LinearReceiveTarget,
  LinearInstrumentationMetadata
>;
const route = definition.routes[0] as HttpRouteDefinition<LinearChannelState>;
const events: ChannelEvents<LinearChannelContext> = definition.events ?? {};

// The mocks answer with the shape each assertion reads, not a whole eve
// `Session` / `RouteHandlerArgs`; one cast keeps the seam honest about that.
const routeArgs = (
  waitUntil: (task: Promise<unknown>) => void,
): RouteHandlerArgs<LinearChannelState> =>
  ({
    cancel: cancelMock,
    getSession: vi.fn(),
    params: {},
    receive: vi.fn(),
    requestIp: null,
    reset: vi.fn(),
    resolveActiveSession: vi.fn(),
    send: sendMock,
    waitUntil,
  }) as unknown as RouteHandlerArgs<LinearChannelState>;

const eventChannel = (
  state: Partial<LinearStateWithPending> = {},
  linear: Partial<LinearHandle> = {},
): LinearEventContext =>
  ({
    continuationToken: "linear:sess-1",
    linear,
    setContinuationToken: vi.fn(),
    state,
  }) as unknown as LinearEventContext;

/** Every event payload carries these; no assertion here reads them. */
const turnMeta = { sequence: 0, stepIndex: 0, turnId: "turn-1" };

type EventDataOf<K extends keyof ChannelEvents<LinearChannelContext>> =
  Parameters<NonNullable<ChannelEvents<LinearChannelContext>[K]>>[0];

type MessageCompletedData = EventDataOf<"message.completed">;
type AuthorizationRequiredData = EventDataOf<"authorization.required">;
type AuthorizationCompletedData = EventDataOf<"authorization.completed">;

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

const agentSession = {
  id: "sess-1",
  url: "https://linear.app/sess-1",
  commentId: null,
  issueId: "issue-1",
  issue: { id: "issue-1", identifier: "HAR-2", title: "t", url: "u" },
  organizationId: "org-1",
  sourceCommentId: null,
};

const createdEvent = {
  kind: "agent_session",
  action: "created",
  agentSession,
  delivery: { event: "AgentSessionEvent", id: "delivery-1" },
  previousComments: [],
  raw: {},
};

const promptedEvent = {
  kind: "agent_session",
  action: "prompted",
  agentSession,
  agentActivity: {
    body: "actually, cancel and redo it",
    content: {},
    id: "activity-1",
  },
  delivery: { event: "AgentSessionEvent", id: "delivery-2" },
  previousComments: [],
  raw: {},
};

const invoke = async (event: unknown) => {
  const req = new Request("http://localhost/eve/v1/linear", {
    method: "POST",
    body: JSON.stringify(event),
  });
  const waitUntil = vi.fn((task: Promise<unknown>) => {
    waitUntilTasks.push(task);
  });
  const response = await route.handler(req, routeArgs(waitUntil));
  await Promise.all(waitUntilTasks);
  return response;
};

describe("agent/channels/linear (cancel-before-send)", () => {
  it("cancels the in-flight turn before dispatching a prompted webhook", async () => {
    order.length = 0;
    cancelMock.mockClear();
    sendMock.mockClear();
    waitUntilTasks.length = 0;

    const response = await invoke(promptedEvent);

    expect(response.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["cancel", "send"]);
  });

  it("also cancels before dispatching a created webhook", async () => {
    order.length = 0;
    cancelMock.mockClear();
    sendMock.mockClear();
    waitUntilTasks.length = 0;

    const response = await invoke(createdEvent);

    expect(response.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["cancel", "send", "advance"]);
  });

  it("cancels with the continuation token for the event's agent session id", async () => {
    order.length = 0;
    cancelMock.mockClear();
    sendMock.mockClear();
    waitUntilTasks.length = 0;

    await invoke(promptedEvent);

    expect(cancelMock).toHaveBeenCalledWith({
      continuationToken: `linear:${agentSession.id}`,
    });
  });

  it("returns 401 and never dispatches when the webhook fails verification", async () => {
    webhookVerifier.mockResolvedValueOnce(false);
    cancelMock.mockClear();
    sendMock.mockClear();
    waitUntilTasks.length = 0;

    const req = new Request("http://localhost/eve/v1/linear", {
      method: "POST",
      body: JSON.stringify(promptedEvent),
    });
    const waitUntil = vi.fn((task: Promise<unknown>) =>
      waitUntilTasks.push(task),
    );
    const response = await route.handler(req, routeArgs(waitUntil));
    await Promise.all(waitUntilTasks);

    expect(response.status).toBe(401);
    expect(cancelMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

const stoppedEvent = {
  ...promptedEvent,
  agentActivity: {
    ...promptedEvent.agentActivity,
    signal: "stop",
  },
};

describe("human-to-agent stop signal (HAR-39)", () => {
  const reset = () => {
    order.length = 0;
    cancelMock.mockClear();
    sendMock.mockClear();
    waitUntilTasks.length = 0;
    vi.mocked(createLinearAgentActivity).mockClear();
  };

  it("cancels the turn and posts a response activity without dispatching on stop signal", async () => {
    reset();

    await invoke(stoppedEvent);

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith({
      continuationToken: "linear:sess-1",
    });
    expect(sendMock).not.toHaveBeenCalled();
    const activity = vi
      .mocked(createLinearAgentActivity)
      .mock.calls.at(-1)?.[0].activity;
    expect(activity).toMatchObject({
      agentSessionId: "sess-1",
      content: { type: "response" },
    });
    expect(activity?.ephemeral).not.toBe(true);
    expect((activity?.content as { body?: string })?.body).toContain(
      "Stopped. This session will not take further action",
    );
  });

  it("does not affect a normal prompted event (no signal, or non-stop signal)", async () => {
    reset();

    await invoke(promptedEvent);

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["cancel", "send"]);
  });
});

describe("duplicate created-session guard", () => {
  const reset = () => {
    order.length = 0;
    cancelMock.mockClear();
    sendMock.mockClear();
    waitUntilTasks.length = 0;
    vi.mocked(callLinearGraphQL).mockClear();
    vi.mocked(createLinearAgentActivity).mockClear();
  };

  const liveSessions = (nodes: readonly unknown[]) => ({
    issue: {
      agentSessions: {
        nodes: nodes.map((node) =>
          node && typeof node === "object" && !("activities" in node)
            ? {
                ...node,
                activities: {
                  nodes: [
                    { updatedAt: new Date(Date.now() - 60_000).toISOString() },
                  ],
                },
              }
            : node,
        ),
      },
    },
  });

  it("declines a created session when an older session is already live on the issue", async () => {
    reset();
    vi.mocked(callLinearGraphQL).mockResolvedValueOnce(
      liveSessions([
        {
          id: "sess-0",
          status: "active",
          createdAt: "2026-07-25T10:00:00.000Z",
          url: "https://linear.app/sess-0",
        },
        {
          id: "sess-1",
          status: "pending",
          createdAt: "2026-07-25T11:00:00.000Z",
          url: "https://linear.app/sess-1",
        },
      ]),
    );

    await invoke(createdEvent);

    expect(cancelMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    const activity = vi
      .mocked(createLinearAgentActivity)
      .mock.calls.at(-1)?.[0].activity;
    expect(activity).toMatchObject({
      agentSessionId: "sess-1",
      content: { type: "response" },
    });
    expect((activity?.content as { body?: string })?.body).toContain(
      "https://linear.app/sess-0",
    );
  });

  it("dispatches when the created session is the oldest live one", async () => {
    reset();
    vi.mocked(callLinearGraphQL).mockResolvedValueOnce(
      liveSessions([
        {
          id: "sess-1",
          status: "pending",
          createdAt: "2026-07-25T10:00:00.000Z",
          url: "https://linear.app/sess-1",
        },
        {
          id: "sess-9",
          status: "pending",
          createdAt: "2026-07-25T11:00:00.000Z",
          url: "https://linear.app/sess-9",
        },
      ]),
    );

    await invoke(createdEvent);

    expect(order).toEqual(["cancel", "send", "advance"]);
  });

  it("never guards prompted events", async () => {
    reset();

    await invoke(promptedEvent);

    expect(callLinearGraphQL).not.toHaveBeenCalled();
    expect(order).toEqual(["cancel", "send"]);
  });
});

describe("issue lifecycle sync on dispatch", () => {
  const reset = () => {
    order.length = 0;
    cancelMock.mockClear();
    sendMock.mockClear();
    waitUntilTasks.length = 0;
    vi.mocked(callLinearGraphQL).mockClear();
    vi.mocked(createLinearAgentActivity).mockClear();
    advanceIssueStateMock.mockClear();
  };

  it("moves the issue to In Progress after dispatching a created session", async () => {
    reset();

    await invoke(createdEvent);

    expect(advanceIssueStateMock).toHaveBeenCalledTimes(1);
    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueRef: "issue-1", target: "inProgress" }),
    );
    expect(order).toEqual(["cancel", "send", "advance"]);
  });

  it("never syncs on prompted events", async () => {
    reset();

    await invoke(promptedEvent);

    expect(advanceIssueStateMock).not.toHaveBeenCalled();
  });

  it("never syncs a guard-declined duplicate session", async () => {
    reset();
    vi.mocked(callLinearGraphQL).mockResolvedValueOnce({
      issue: {
        agentSessions: {
          nodes: [
            {
              id: "sess-0",
              status: "active",
              createdAt: "2026-07-25T10:00:00.000Z",
              url: null,

              activities: {
                nodes: [
                  { updatedAt: new Date(Date.now() - 60_000).toISOString() },
                ],
              },
            },
          ],
        },
      },
    });

    await invoke(createdEvent);

    expect(sendMock).not.toHaveBeenCalled();
    expect(advanceIssueStateMock).not.toHaveBeenCalled();
  });

  it("syncs a handoff-successor session (creator is the app user)", async () => {
    reset();

    await invoke({
      ...createdEvent,
      agentSession: {
        ...agentSession,
        appUserId: "app-user-1",
        creatorId: "app-user-1",
      },
    });

    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: "inProgress" }),
    );
  });

  it("skips the sync when the session carries no issue id", async () => {
    reset();

    await invoke({
      ...createdEvent,
      agentSession: { ...agentSession, issue: null, issueId: null },
    });

    expect(sendMock).toHaveBeenCalled();
    expect(advanceIssueStateMock).not.toHaveBeenCalled();
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

describe("actions.requested ephemeral render", () => {
  const postAction = async (action: ActionRequest) => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await events["actions.requested"]?.(
      { ...turnMeta, actions: [action] },
      eventChannel({ agentSessionId: "sess-1", pendingToolCallMessage: null }),
      sessionCtx,
    );
    return vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0].activity;
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
    vi.mocked(createLinearAgentActivity).mockClear();
    const state: Partial<LinearStateWithPending> = {
      agentSessionId: "sess-1",
      pendingToolCallMessage,
    };
    await events["actions.requested"]?.(
      { ...turnMeta, actions },
      eventChannel(state),
      sessionCtx,
    );
    return {
      calls: vi
        .mocked(createLinearAgentActivity)
        .mock.calls.map((call) => call[0].activity),
      state,
    };
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
    vi.mocked(createLinearAgentActivity).mockClear();
    const state = await fireMessageCompleted({
      message: "Done. Five tickets created.",
      finishReason: "stop",
    });

    expect(state.pendingToolCallMessage).toBeNull();
    const activity = vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0]
      .activity;
    expect(activity?.content).toMatchObject({
      body: "Done. Five tickets created.",
      type: "response",
    });
  });
});

describe("ask_question confirmation gate stays self-contained (HAR-78)", () => {
  it("keeps the full proposal visible ahead of a terse ask_question prompt, in order", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    vi.mocked(renderLinearInputRequests).mockReturnValueOnce(
      "Create it as described?\n\n1. Yes, create it as described\n2. Don't do this",
    );
    vi.mocked(linearInputRequestSignal).mockReturnValueOnce({
      signal: "select",
      signalMetadata: {
        options: [{ label: "Yes, create it as described", value: "approve" }],
      },
    });

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

    const posted = vi
      .mocked(createLinearAgentActivity)
      .mock.calls.map((call) => call[0].activity.content);

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
    vi.mocked(createLinearAgentActivity).mockClear();
    vi.mocked(renderLinearInputRequests).mockReturnValueOnce(
      "Approve this breakdown?\n\n1. Approve\n2. Revise",
    );
    vi.mocked(linearInputRequestSignal).mockReturnValueOnce({
      signal: "select",
      signalMetadata: {
        options: [
          { label: "Approve", value: "approve" },
          { label: "Revise", value: "revise" },
        ],
      },
    });
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

    expect(renderLinearInputRequests).toHaveBeenCalledWith(requests);
    expect(linearInputRequestSignal).toHaveBeenCalledWith(requests);
    const activity = vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0]
      .activity;
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

describe("inbound image dispatch integration", () => {
  it("sends a multimodal message and still cancels before send", async () => {
    order.length = 0;
    cancelMock.mockClear();
    sendMock.mockClear();
    waitUntilTasks.length = 0;
    vi.mocked(messageFromLinearAgentSessionEvent).mockReturnValueOnce(
      "see ![](https://uploads.linear.app/abc/shot.png)",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    try {
      await invoke(promptedEvent);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(order).toEqual(["cancel", "send"]);
    const payload = (sendMock.mock.calls[0] as unknown[])?.[0] as {
      message: unknown;
    };
    expect(payload.message).toEqual([
      { text: "see ", type: "text" },
      { data: Buffer.from([1, 2, 3]), mediaType: "image/png", type: "file" },
    ]);
  });
});

describe("action.result plan sync", () => {
  const postActionResult = async (
    data: Pick<ActionResultData, "result" | "status">,
  ) => {
    vi.mocked(updateLinearAgentSession).mockClear();
    await events["action.result"]?.(
      { ...turnMeta, ...data },
      eventChannel(
        { agentSessionId: "sess-1" },
        {
          updateSession: (update) =>
            updateLinearAgentSession({ id: "sess-1", update } as never),
        },
      ),
      sessionCtx,
    );
    return vi.mocked(updateLinearAgentSession).mock.calls[0]?.[0];
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
      id: "sess-1",
      update: { plan: [{ content: "Ship it", status: "inProgress" }] },
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
    expect(updateLinearAgentSession).not.toHaveBeenCalled();
  });
});

describe("action.result durable chip promotion (HAR-45, preserved through HAR-68)", () => {
  const fireActionResult = async (
    data: Pick<ActionResultData, "error" | "result" | "status">,
    pendingActionsByCallId: LinearStateWithPending["pendingActionsByCallId"] = {},
  ) => {
    vi.mocked(createLinearAgentActivity).mockClear();
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

    expect(createLinearAgentActivity).toHaveBeenCalledTimes(1);
    const call = vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0];
    expect(call.activity.ephemeral).toBeUndefined();
    expect(call.activity.content).toEqual({
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

    expect(createLinearAgentActivity).not.toHaveBeenCalled();
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

    expect(createLinearAgentActivity).toHaveBeenCalledTimes(1);
    const content = vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0]
      .activity.content as Record<string, unknown>;
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

    const content = vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0]
      .activity.content as Record<string, string>;
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

    vi.mocked(createLinearAgentActivity).mockClear();
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

    expect(createLinearAgentActivity).toHaveBeenCalledTimes(1);

    await events["action.result"]?.(
      doneOnC3,
      eventChannel(
        { agentSessionId: "sess-1", pendingActionsByCallId: {} },
        { updateSession: vi.fn() },
      ),
      sessionCtx,
    );

    expect(createLinearAgentActivity).toHaveBeenCalledTimes(1);
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

    expect(createLinearAgentActivity).toHaveBeenCalledTimes(1);
    const call = vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0];
    expect(call.activity.ephemeral).toBeUndefined();
    expect(call.activity.content).toEqual({
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

    expect(createLinearAgentActivity).toHaveBeenCalledTimes(1);
    const content = vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0]
      .activity.content as Record<string, unknown>;
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

    expect(createLinearAgentActivity).not.toHaveBeenCalled();
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

    expect(createLinearAgentActivity).toHaveBeenCalledTimes(1);
    const content = vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0]
      .activity.content as Record<string, unknown>;
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

  const lastActivity = () =>
    vi.mocked(createLinearAgentActivity).mock.calls.at(-1)?.[0].activity;

  it("posts an elicitation with Linear's native auth signal and the challenge URL", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await fireAuthorizationRequired({
      authorization: {
        displayName: "Linear MCP",
        url: "https://example.com/oauth",
      },
      description: "Authorize the linear connection",
      name: "linear",
    });
    expect(lastActivity()).toMatchObject({
      agentSessionId: "sess-1",
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
    expect(lastActivity()?.ephemeral).not.toBe(true);
  });

  it("title-cases the connection name and omits userId for a non-Linear principal", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await fireAuthorizationRequired(
      {
        authorization: { url: "https://example.com/oauth" },
        description: "Authorize the vercel connection",
        name: "vercel",
      },
      authCtx(null),
    );
    const activity = lastActivity();
    expect(activity?.signalMetadata).toEqual({
      providerName: "Vercel",
      url: "https://example.com/oauth",
    });
  });

  it("falls back to a plain elicitation with instructions when the challenge has no URL", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await fireAuthorizationRequired({
      authorization: {
        instructions: "Approve the sign-in request on your phone.",
        userCode: "ABCD-1234",
      },
      description: "Authorize the linear connection",
      name: "linear",
    });
    const activity = lastActivity();
    expect(activity?.signal).toBeUndefined();
    expect(activity?.content).toMatchObject({ type: "elicitation" });
    const body = (activity?.content as { body?: string })?.body ?? "";
    expect(body).toContain("Approve the sign-in request on your phone.");
    expect(body).toContain("Code: `ABCD-1234`");
  });

  it("posts an ephemeral resuming thought once authorization completes", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await fireAuthorizationCompleted({
      authorization: { displayName: "Linear MCP" },
      name: "linear",
      outcome: "authorized",
    });
    expect(lastActivity()).toMatchObject({
      content: { body: "Connected to Linear MCP. Resuming.", type: "thought" },
      ephemeral: true,
    });
  });

  it("reports a non-authorized outcome durably", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await fireAuthorizationCompleted({
      name: "linear",
      outcome: "timed-out",
      reason: "challenge expired",
    });
    expect(lastActivity()).toMatchObject({
      content: {
        body: "Authorization for Linear timed out: challenge expired",
        type: "thought",
      },
    });
    expect(lastActivity()?.ephemeral).not.toBe(true);
  });
});

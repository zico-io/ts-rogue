import { describe, expect, it, vi } from "vitest";

// This module hand-rolls eve's built-in `linearChannel()` via `defineChannel`
// so the agent-session dispatch path can reach `cancel()` before `send()`.
// Mirrors the mocking pattern in `src/child-relay.test.ts`: stub the eve
// building blocks, import the real module under test, and drive its route
// handler / exported helpers directly.

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
    // Bypasses signature verification for the happy-path tests (the signature
    // math itself is exercised by eve's own tests via `signLinearWebhookBody`).
    webhookVerifier: vi.fn(async () => true),
  }));

vi.mock("@vercel/connect/eve", () => ({
  connectLinearCredentials: () => ({ webhookVerifier }),
}));

vi.mock("eve/channels", () => ({
  defineChannel: (definition: unknown) => definition,
  POST: (path: string, handler: unknown) => ({ method: "POST", path, handler }),
}));

vi.mock("eve/channels/linear", () => ({
  // Default: no prior activities - individual tests override this with
  // `mockResolvedValueOnce` to feed a signalMetadata-carrying elicitation
  // activity into `resolvePromptResponses`'s `listElicitationActivities` call.
  callLinearGraphQL: vi.fn(async () => ({
    agentSession: { activities: { nodes: [] } },
  })),
  createLinearAgentActivity: vi.fn(async () => ({ id: "a", success: true })),
  createLinearAgentSessionOnComment: vi.fn(async () => ({ id: "sess-new" })),
  createLinearAgentSessionOnIssue: vi.fn(async () => ({ id: "sess-new" })),
  defaultOnAgentSession: vi.fn(() => ({ auth: null })),
  formatLinearContextBlock: vi.fn(() => "context-block"),
  LINEAR_CHANNEL_DEFAULT_ROUTE: "/eve/v1/linear",
  linearContinuationToken: vi.fn(
    (agentSessionId: string) => `linear:${agentSessionId}`,
  ),
  listLinearAgentSessionActivities: vi.fn(async () => []),
  messageFromLinearAgentSessionEvent: vi.fn(() => "message"),
  parseLinearWebhookEvent: vi.fn(({ body }: { body: string }) =>
    JSON.parse(body),
  ),
  signLinearWebhookBody: vi.fn(
    () => "unused-because-webhookVerifier-bypasses-it",
  ),
  updateLinearAgentSession: vi.fn(async () => ({ success: true })),
}));

const {
  default: channel,
  resolveReceiveSession,
  stateFromAgentSession,
} = await import("../agent/channels/linear");
const { callLinearGraphQL, createLinearAgentActivity } = await import(
  "eve/channels/linear"
);

// biome-ignore lint/suspicious/noExplicitAny: reaching into the mocked channel shape for tests
const route = (channel as any).routes[0] as {
  handler: (
    req: Request,
    args: {
      // biome-ignore lint/suspicious/noExplicitAny: mocked handler args
      send: any;
      // biome-ignore lint/suspicious/noExplicitAny: mocked handler args
      cancel: any;
      // biome-ignore lint/suspicious/noExplicitAny: mocked handler args
      waitUntil: any;
      // biome-ignore lint/suspicious/noExplicitAny: mocked handler args
      getSession: any;
      // biome-ignore lint/suspicious/noExplicitAny: mocked handler args
      receive: any;
      params: Record<string, string>;
      requestIp: string | null;
    },
  ) => Promise<Response>;
};

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
  const response = await route.handler(req, {
    send: sendMock,
    cancel: cancelMock,
    waitUntil,
    getSession: vi.fn(),
    receive: vi.fn(),
    params: {},
    requestIp: null,
  });
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
    expect(order).toEqual(["cancel", "send"]);
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
    const response = await route.handler(req, {
      send: sendMock,
      cancel: cancelMock,
      waitUntil,
      getSession: vi.fn(),
      receive: vi.fn(),
      params: {},
      requestIp: null,
    });
    await Promise.all(waitUntilTasks);

    expect(response.status).toBe(401);
    expect(cancelMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("actions.requested ephemeral render", () => {
  const postAction = async (action: unknown) => {
    vi.mocked(createLinearAgentActivity).mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    await (channel as any).events["actions.requested"](
      { actions: [action] },
      { state: { agentSessionId: "sess-1", pendingToolCallMessage: null } },
    );
    return vi.mocked(createLinearAgentActivity).mock.calls[0]?.[0].activity;
  };

  it("labels a subagent-call with the delegation packet's lead line, not the static tool description", async () => {
    // The static `agent` tool description froze the ephemeral chip on
    // meaningless text for entire child runs; the packet's first line names
    // the delegated issue.
    const activity = await postAction({
      kind: "subagent-call",
      name: "agent",
      description: "Delegate a focused subtask to a fresh copy of yourself.",
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
      kind: "subagent-call",
      name: "agent",
      description: "Delegate a focused subtask to a fresh copy of yourself.",
      input: { message: "   \n  " },
    });
    expect(activity?.content).toMatchObject({
      parameter: "Delegate a focused subtask to a fresh copy of yourself.",
    });
  });

  it("keeps rendering plain tool calls from their input", async () => {
    const activity = await postAction({
      kind: "tool-call",
      toolName: "bash",
      input: { command: "git status" },
    });
    expect(activity?.content).toEqual({
      action: "bash",
      parameter: '{"command":"git status"}',
      type: "action",
    });
  });
});

describe("stateFromAgentSession", () => {
  it("maps a Linear agent session ref into channel state", () => {
    expect(stateFromAgentSession(agentSession)).toEqual({
      agentSessionId: "sess-1",
      agentSessionUrl: "https://linear.app/sess-1",
      commentId: null,
      issueId: "issue-1",
      issueIdentifier: "HAR-2",
      issueTitle: "t",
      issueUrl: "u",
      organizationId: "org-1",
      pendingToolCallMessage: null,
      sourceCommentId: null,
    });
  });

  it("falls back to the nested issue id when issueId is absent", () => {
    expect(
      stateFromAgentSession({ id: "sess-2", issue: { id: "issue-9" } }),
    ).toMatchObject({ issueId: "issue-9" });
  });
});

describe("resolveReceiveSession", () => {
  it("returns the target session id directly when provided", async () => {
    await expect(
      resolveReceiveSession({ agentSessionId: "sess-3" }, {}),
    ).resolves.toEqual({ id: "sess-3" });
  });

  it("throws when the target has no usable identifier", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard for an invalid target
    await expect(resolveReceiveSession({} as any, {})).rejects.toThrow(
      "linearChannel().receive requires target.agentSessionId, issueId, or commentId.",
    );
  });
});

describe("input.requested elicitation activity (HAR-17 signalMetadata)", () => {
  const requests = [
    {
      action: {
        callId: "linear-input:req-1",
        input: {},
        kind: "tool-call",
        toolName: "linear_input",
      },
      prompt: "Approve this plan?",
      requestId: "req-1",
      allowFreeform: false,
      options: [
        { id: "approve", label: "Approve" },
        { id: "revise", label: "Revise" },
      ],
    },
  ];

  it("renders a clean body with no hidden tracking marker", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    await (channel as any).events["input.requested"](
      { requests },
      { state: { agentSessionId: "sess-1" } },
    );
    const call = vi.mocked(createLinearAgentActivity).mock.calls.at(-1)?.[0];
    const body = call?.activity.content as { body: string; type: string };

    expect(body.type).toBe("elicitation");
    expect(body.body).not.toContain("<!--");
    expect(body.body).not.toContain("eve-input");
    expect(body.body).toContain("Approve this plan?");
    expect(body.body).toContain("1. Approve");
    expect(body.body).toContain("2. Revise");
  });

  it("carries the requests in signalMetadata instead of the body", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    await (channel as any).events["input.requested"](
      { requests },
      { state: { agentSessionId: "sess-1" } },
    );
    const call = vi.mocked(createLinearAgentActivity).mock.calls.at(-1)?.[0];

    expect(call?.activity.signalMetadata).toEqual({
      eveInputRequests: [
        {
          requestId: "req-1",
          allowFreeform: false,
          options: [
            { id: "approve", label: "Approve" },
            { id: "revise", label: "Revise" },
          ],
        },
      ],
    });
  });
});

describe("resolving a prompted reply from signalMetadata (HAR-17)", () => {
  const optionRequest = {
    requestId: "req-1",
    options: [
      { id: "approve", label: "Approve" },
      { id: "revise", label: "Revise" },
    ],
  };
  const freeformRequest = {
    requestId: "req-2",
    allowFreeform: true,
    options: [{ id: "approve", label: "Approve" }],
  };

  const elicitationActivity = (request: unknown) => ({
    id: "act-1",
    content: { type: "elicitation", body: "rendered elicitation" },
    signalMetadata: { eveInputRequests: [request] },
  });

  const promptedWith = (body: string) => ({
    kind: "agent_session",
    action: "prompted",
    agentSession,
    agentActivity: { body, content: {}, id: "activity-reply" },
    delivery: { event: "AgentSessionEvent", id: "delivery-reply" },
    previousComments: [],
    raw: {},
  });

  const lastInputResponses = () =>
    // biome-ignore lint/suspicious/noExplicitAny: sendMock's inferred type has no call args to index
    (sendMock.mock.calls as any[]).at(-1)?.[0]?.inputResponses;

  it("matches a reply by option id", async () => {
    vi.mocked(callLinearGraphQL).mockResolvedValueOnce({
      agentSession: {
        activities: { nodes: [elicitationActivity(optionRequest)] },
      },
    });
    await invoke(promptedWith("approve"));
    expect(lastInputResponses()).toEqual([
      { requestId: "req-1", optionId: "approve" },
    ]);
  });

  it("matches a reply by option label, case-insensitively", async () => {
    vi.mocked(callLinearGraphQL).mockResolvedValueOnce({
      agentSession: {
        activities: { nodes: [elicitationActivity(optionRequest)] },
      },
    });
    await invoke(promptedWith("Revise"));
    expect(lastInputResponses()).toEqual([
      { requestId: "req-1", optionId: "revise" },
    ]);
  });

  it("matches a reply by 1-based option number", async () => {
    vi.mocked(callLinearGraphQL).mockResolvedValueOnce({
      agentSession: {
        activities: { nodes: [elicitationActivity(optionRequest)] },
      },
    });
    await invoke(promptedWith("2"));
    expect(lastInputResponses()).toEqual([
      { requestId: "req-1", optionId: "revise" },
    ]);
  });

  it("falls back to the raw text when the request allows freeform and nothing matches", async () => {
    vi.mocked(callLinearGraphQL).mockResolvedValueOnce({
      agentSession: {
        activities: { nodes: [elicitationActivity(freeformRequest)] },
      },
    });
    await invoke(promptedWith("do it differently"));
    expect(lastInputResponses()).toEqual([
      { requestId: "req-2", text: "do it differently" },
    ]);
  });
});

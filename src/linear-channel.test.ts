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

// Harness-owned issue lifecycle: mocked so dispatch tests can assert the
// transition calls without the module's own GraphQL traffic muddying the
// `callLinearGraphQL` assertions (the guard's live-session query).
const { advanceIssueStateMock } = vi.hoisted(() => ({
  advanceIssueStateMock: vi.fn(async () => {
    order.push("advance");
  }),
}));

vi.mock("../agent/lib/issue-state", () => ({
  advanceIssueState: advanceIssueStateMock,
}));

vi.mock("@vercel/connect/eve", () => ({
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
  // The duplicate-session guard's live-session pre-check (via
  // `agent/lib/live-sessions`). Defaults to "no sessions on the issue" so
  // the dispatch tests below exercise the pass-through path.
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

const {
  default: channel,
  attachLinearInboundImages,
  planFromTodoToolOutput,
  resolveReceiveSession,
  stateFromAgentSession,
} = await import("../agent/channels/linear");
const {
  callLinearGraphQL,
  createLinearAgentActivity,
  linearInputRequestSignal,
  messageFromLinearAgentSessionEvent,
  renderLinearInputRequests,
  updateLinearAgentSession,
} = await import("eve/channels/linear");

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

  // listLiveAgentSessions now excludes sessions idle past STALE_SESSION_MS, so a
  // blocking mock session needs a recent "last active" signal to count as live.
  // Expressed relative to Date.now() for determinism without pinning the clock;
  // createdAt stays whatever the test sets, as it only drives oldest-wins order.
  const liveSessions = (nodes: readonly unknown[]) => ({
    issue: {
      agentSessions: {
        nodes: nodes.map((node) =>
          node && typeof node === "object" && !("activities" in node)
            ? {
                ...(node as object),
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

  it("dispatches when the only older session is stale (idle past the threshold)", async () => {
    reset();
    vi.mocked(callLinearGraphQL).mockResolvedValueOnce(
      liveSessions([
        {
          id: "sess-0",
          status: "active",
          createdAt: "2026-07-25T10:00:00.000Z", // older than the newcomer sess-1
          url: "https://linear.app/sess-0",
          // Silent well past STALE_SESSION_MS, so it no longer blocks.
          activities: {
            nodes: [
              { updatedAt: new Date(Date.now() - 60 * 60_000).toISOString() },
            ],
          },
        },
      ]),
    );

    await invoke(createdEvent);

    expect(order).toEqual(["cancel", "send", "advance"]);
    expect(createLinearAgentActivity).not.toHaveBeenCalled();
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

  it("exempts agent-created sessions (handoff successors) without querying", async () => {
    reset();

    await invoke({
      ...createdEvent,
      agentSession: {
        ...agentSession,
        appUserId: "app-user-1",
        creatorId: "app-user-1",
      },
    });

    expect(callLinearGraphQL).not.toHaveBeenCalled();
    expect(order).toEqual(["cancel", "send", "advance"]);
  });

  it("never guards prompted events", async () => {
    reset();

    await invoke(promptedEvent);

    expect(callLinearGraphQL).not.toHaveBeenCalled();
    expect(order).toEqual(["cancel", "send"]);
  });

  it("fails open when the live-session query errors", async () => {
    reset();
    vi.mocked(callLinearGraphQL).mockRejectedValueOnce(
      new Error("Linear is down"),
    );

    await invoke(createdEvent);

    expect(order).toEqual(["cancel", "send", "advance"]);
  });

  it("fails open when the session carries no issue id", async () => {
    reset();

    await invoke({
      ...createdEvent,
      agentSession: { ...agentSession, issue: null, issueId: null },
    });

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
              // Recent activity so it counts as live and still blocks sess-1.
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
  const failureData = { message: "boom", details: {} };
  const channelCtx = (issueId: string | null) => ({
    state: { agentSessionId: "sess-1", issueId, pendingToolCallMessage: null },
  });

  it("moves the issue to Blocked on session.failed", async () => {
    advanceIssueStateMock.mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    await (channel as any).events["session.failed"](
      failureData,
      channelCtx("issue-1"),
    );

    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueRef: "issue-1", target: "blocked" }),
    );
  });

  it("skips the sync when the failed session has no issue", async () => {
    advanceIssueStateMock.mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    await (channel as any).events["session.failed"](
      failureData,
      channelCtx(null),
    );

    expect(advanceIssueStateMock).not.toHaveBeenCalled();
  });

  it("never syncs on turn.failed (recoverable)", async () => {
    advanceIssueStateMock.mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    await (channel as any).events["turn.failed"](
      failureData,
      channelCtx("issue-1"),
    );

    expect(advanceIssueStateMock).not.toHaveBeenCalled();
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

describe("input.requested elicitation (HAR-17)", () => {
  it("posts a clean elicitation body with Linear's native select signal, not a hidden tracking marker", async () => {
    // HAR-17: eve's Linear channel used to track which pending request a
    // reply answered by appending a base64 `<!-- eve-input:... -->` blob
    // into the same visible message body it rendered. Since eve 0.27 the
    // runtime matches replies to pending requests itself, so
    // `renderLinearInputRequests` renders clean prompt/option text and the
    // tracking metadata (via `linearInputRequestSignal`) rides Linear's own
    // `signal`/`signalMetadata` activity fields instead of the body.
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
    const requests = [
      {
        requestId: "req-1",
        prompt: "Approve this breakdown?",
        options: [
          { id: "approve", label: "Approve" },
          { id: "revise", label: "Revise" },
        ],
      },
    ];

    await // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    (channel as any).events["input.requested"](
      { requests },
      { state: { agentSessionId: "sess-1" } },
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

describe("attachLinearInboundImages", () => {
  const UPLOAD_URL = "https://uploads.linear.app/abc/shot.png";
  const pngResponse = () =>
    new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });

  it("returns text without image references unchanged and never fetches", async () => {
    const fetchMock = vi.fn();
    await expect(
      attachLinearInboundImages({
        content: "no images here",
        credentials: { accessToken: "tok" },
        fetch: fetchMock,
      }),
    ).resolves.toBe("no images here");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a trusted upload with Bearer auth and replaces its markdown with alt text plus a file part", async () => {
    const fetchMock = vi.fn(async () => pngResponse());
    const result = await attachLinearInboundImages({
      content: `see ![screenshot](${UPLOAD_URL}) here`,
      credentials: { accessToken: "tok" },
      fetch: fetchMock,
    });
    expect(fetchMock).toHaveBeenCalledWith(UPLOAD_URL, {
      credentials: "omit",
      headers: { accept: "image/*", authorization: "Bearer tok" },
      redirect: "manual",
    });
    expect(result).toEqual([
      { text: "see screenshot here", type: "text" },
      {
        data: Buffer.from([137, 80, 78, 71]),
        mediaType: "image/png",
        type: "file",
      },
    ]);
  });

  it("returns file parts alone when the message is only an image", async () => {
    const result = await attachLinearInboundImages({
      content: `![](${UPLOAD_URL})`,
      credentials: { accessToken: "tok" },
      fetch: vi.fn(async () => pngResponse()),
    });
    expect(result).toEqual([
      {
        data: Buffer.from([137, 80, 78, 71]),
        mediaType: "image/png",
        type: "file",
      },
    ]);
  });

  it("never fetches untrusted origins or credentialed URLs", async () => {
    const fetchMock = vi.fn();
    const content =
      "![a](https://evil.example/x.png) ![b](https://user:pw@uploads.linear.app/x.png)";
    await expect(
      attachLinearInboundImages({
        content,
        credentials: { accessToken: "tok" },
        fetch: fetchMock,
      }),
    ).resolves.toBe(content);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a failed reference's markdown while attaching the successful one", async () => {
    const failedUrl = "https://uploads.linear.app/abc/missing.png";
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      url === UPLOAD_URL ? pngResponse() : new Response(null, { status: 404 }),
    );
    const result = await attachLinearInboundImages({
      content: `![ok](${UPLOAD_URL}) and ![gone](${failedUrl})`,
      credentials: { accessToken: "tok" },
      fetch: fetchMock,
    });
    expect(result).toEqual([
      { text: `ok and ![gone](${failedUrl})`, type: "text" },
      {
        data: Buffer.from([137, 80, 78, 71]),
        mediaType: "image/png",
        type: "file",
      },
    ]);
  });

  it("treats a non-image content-type as failure", async () => {
    const content = `![x](${UPLOAD_URL})`;
    await expect(
      attachLinearInboundImages({
        content,
        credentials: { accessToken: "tok" },
        fetch: vi.fn(
          async () =>
            new Response("<html></html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        ),
      }),
    ).resolves.toBe(content);
  });

  it("returns the raw text when no access token resolves", async () => {
    vi.stubEnv("LINEAR_AGENT_ACCESS_TOKEN", "");
    vi.stubEnv("LINEAR_ACCESS_TOKEN", "");
    vi.stubEnv("LINEAR_API_KEY", "");
    vi.stubEnv("LINEAR_API_TOKEN", "");
    try {
      const fetchMock = vi.fn();
      const content = `![x](${UPLOAD_URL})`;
      await expect(
        attachLinearInboundImages({ content, fetch: fetchMock }),
      ).resolves.toBe(content);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns the raw text when the access token thunk throws", async () => {
    const content = `![x](${UPLOAD_URL})`;
    await expect(
      attachLinearInboundImages({
        content,
        credentials: {
          accessToken: () => {
            throw new Error("connect unavailable");
          },
        },
        fetch: vi.fn(),
      }),
    ).resolves.toBe(content);
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

describe("planFromTodoToolOutput", () => {
  it("maps todo tool output into Linear plan entries", () => {
    expect(
      planFromTodoToolOutput({
        counts: {
          cancelled: 1,
          completed: 1,
          in_progress: 1,
          pending: 1,
          total: 4,
        },
        todos: [
          {
            content: "Read orientation",
            priority: "high",
            status: "completed",
          },
          {
            content: "Implement change",
            priority: "high",
            status: "in_progress",
          },
          { content: "Open PR", priority: "medium", status: "pending" },
          { content: "Skip this", priority: "low", status: "cancelled" },
        ],
      }),
    ).toEqual([
      { content: "Read orientation", status: "completed" },
      { content: "Implement change", status: "inProgress" },
      { content: "Open PR", status: "pending" },
      { content: "Skip this", status: "canceled" },
    ]);
  });

  it("drops malformed entries and returns null for a non-object output", () => {
    expect(
      planFromTodoToolOutput({
        todos: [
          { content: "ok", status: "pending" },
          { content: 42, status: "pending" },
          { content: "bad status", status: "unknown" },
        ],
      }),
    ).toEqual([{ content: "ok", status: "pending" }]);
    expect(planFromTodoToolOutput("not an object")).toBeNull();
    expect(planFromTodoToolOutput({})).toBeNull();
  });
});

describe("action.result plan sync", () => {
  const postActionResult = async (data: unknown) => {
    vi.mocked(updateLinearAgentSession).mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    await (channel as any).events["action.result"](data, {
      linear: {
        updateSession: (update: unknown) =>
          updateLinearAgentSession({ id: "sess-1", update } as never),
      },
      state: { agentSessionId: "sess-1" },
    });
    return vi.mocked(updateLinearAgentSession).mock.calls[0]?.[0];
  };

  it("pushes the todo tool's list into the session's Linear plan", async () => {
    const call = await postActionResult({
      status: "completed",
      result: {
        kind: "tool-result",
        toolName: "todo",
        output: {
          todos: [
            { content: "Ship it", priority: "high", status: "in_progress" },
          ],
        },
      },
    });
    expect(call).toMatchObject({
      id: "sess-1",
      update: { plan: [{ content: "Ship it", status: "inProgress" }] },
    });
  });

  it("ignores action results for tools other than todo", async () => {
    await postActionResult({
      status: "completed",
      result: { kind: "tool-result", toolName: "bash", output: {} },
    });
    expect(updateLinearAgentSession).not.toHaveBeenCalled();
  });

  it("ignores a failed or errored todo call", async () => {
    await postActionResult({
      status: "failed",
      result: { kind: "tool-result", toolName: "todo", output: { todos: [] } },
    });
    await postActionResult({
      status: "completed",
      result: {
        kind: "tool-result",
        toolName: "todo",
        isError: true,
        output: { todos: [] },
      },
    });
    expect(updateLinearAgentSession).not.toHaveBeenCalled();
  });
});

describe("authorization events surface the OAuth challenge", () => {
  // eve parks the turn on `authorization.required` for a user-scoped
  // `connect(...)` connection. Without these handlers the event is dropped
  // and the Agent Session stalls with no login prompt - the exact symptom
  // of a Linear-delegated task hanging forever.
  const linearUserAuth = {
    attributes: {},
    authenticator: "linear-agent-webhook",
    issuer: "linear:org-1",
    principalId: "linear:user-1",
    principalType: "user",
    subject: "user-1",
  };
  const ctx = { session: { auth: { current: linearUserAuth } } };

  const fire = (event: string, data: unknown, eventCtx: unknown = ctx) =>
    // biome-ignore lint/suspicious/noExplicitAny: driving the channel's event handler directly
    (channel as any).events[event](
      data,
      { state: { agentSessionId: "sess-1" } },
      eventCtx,
    );

  const lastActivity = () =>
    vi.mocked(createLinearAgentActivity).mock.calls.at(-1)?.[0].activity;

  it("posts an elicitation with Linear's native auth signal and the challenge URL", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await fire("authorization.required", {
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
        body: "I need you to connect Linear MCP before I can continue.",
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
    await fire(
      "authorization.required",
      {
        authorization: { url: "https://example.com/oauth" },
        description: "Authorize the vercel connection",
        name: "vercel",
      },
      { session: { auth: { current: null } } },
    );
    const activity = lastActivity();
    expect(activity?.signalMetadata).toEqual({
      providerName: "Vercel",
      url: "https://example.com/oauth",
    });
  });

  it("falls back to a plain elicitation with instructions when the challenge has no URL", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await fire("authorization.required", {
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
    expect(body).toContain("Code: ABCD-1234");
  });

  it("posts an ephemeral resuming thought once authorization completes", async () => {
    vi.mocked(createLinearAgentActivity).mockClear();
    await fire("authorization.completed", {
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
    await fire("authorization.completed", {
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

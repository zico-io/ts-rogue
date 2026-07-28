import type { HttpRouteDefinition, RouteHandlerArgs } from "eve/channels";
import type { LinearChannelState } from "eve/channels/linear";
import { describe, expect, it, vi } from "vitest";

// This file drives the real `eve/channels/linear`: real `linearChannel`, real
// webhook verification and parsing, real inbound-image attachment, real
// GraphQL layer. Only two things are stubbed - the Connect credential broker
// and the network - so what is asserted here is eve's actual behavior plus the
// wrapper `agent/channels/linear.ts` puts around it. The rendering the channel
// wires in is tested in `agent/lib/linear/renderer.test.ts`.

const {
  order,
  cancelMock,
  resetMock,
  resolveActiveSessionMock,
  sendMock,
  waitUntilTasks,
  webhookVerifier,
} = vi.hoisted(() => ({
  order: [] as string[],
  cancelMock: vi.fn(async () => {
    order.push("cancel");
    return { status: "accepted" as const };
  }),
  resetMock: vi.fn(async () => {
    order.push("reset");
    return { status: "reset" as const, previousSessionId: "eve-1" };
  }),
  resolveActiveSessionMock: vi.fn(
    async () => undefined as { sessionId: string } | undefined,
  ),
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

/**
 * Linear's GraphQL endpoint. Every mutation and query the channel makes lands
 * here, so assertions read what eve really put on the wire.
 */
const graphql: { queryName: string; variables: Record<string, unknown> }[] = [];
let liveSessionNodes: readonly unknown[] = [];

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, init: { body?: string }) => {
    if (String(url).includes("uploads.linear.app")) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      });
    }
    const { query, variables } = JSON.parse(init.body ?? "{}");
    const queryName = /(?:mutation|query)\s+(\w+)/.exec(query)?.[1] ?? "";
    graphql.push({ queryName, variables });
    const data: Record<string, unknown> = {
      AgentActivityCreate: {
        agentActivityCreate: { success: true, agentActivity: { id: "a" } },
      },
      AgentSessionUpdate: { agentSessionUpdate: { success: true } },
      IssueLiveAgentSessions: {
        issue: { agentSessions: { nodes: liveSessionNodes } },
      },
    };
    return Response.json({ data: data[queryName] ?? {} });
  }),
);

const { default: channel } = await import("../agent/channels/linear");

const route = channel.routes[0] as HttpRouteDefinition<LinearChannelState>;

/** The Agent Activities posted during a test, in eve's own input shape. */
const activities = () =>
  graphql
    .filter((call) => call.queryName === "AgentActivityCreate")
    .map(
      (call) => (call.variables as { input: Record<string, unknown> }).input,
    );

const reset = () => {
  order.length = 0;
  graphql.length = 0;
  liveSessionNodes = [];
  cancelMock.mockClear();
  sendMock.mockClear();
  advanceIssueStateMock.mockClear();
  resetMock.mockClear();
  resolveActiveSessionMock.mockClear();
  resolveActiveSessionMock.mockResolvedValue(undefined);
  waitUntilTasks.length = 0;
};

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
    reset: resetMock,
    resolveActiveSession: resolveActiveSessionMock,
    send: sendMock,
    waitUntil,
  }) as unknown as RouteHandlerArgs<LinearChannelState>;

const agentSession = {
  id: "sess-1",
  url: "https://linear.app/sess-1",
  commentId: null,
  issueId: "issue-1",
  issue: { id: "issue-1", identifier: "HAR-2", title: "t", url: "u" },
  organizationId: "org-1",
  sourceCommentId: null,
};

/** A real Linear `AgentSessionEvent` webhook body. */
const webhook = (overrides: Record<string, unknown> = {}) => ({
  type: "AgentSessionEvent",
  action: "created",
  agentSession,
  organizationId: "org-1",
  previousComments: [],
  ...overrides,
});

const createdEvent = webhook();

const promptedEvent = webhook({
  action: "prompted",
  agentActivity: {
    id: "activity-1",
    content: { body: "actually, cancel and redo it", type: "prompt" },
  },
});

const stoppedEvent = webhook({
  action: "prompted",
  agentActivity: {
    id: "activity-1",
    content: { body: "stop", type: "prompt" },
    signal: "stop",
  },
});

const liveSession = (id: string, createdAt: string, url: string | null) => ({
  id,
  status: "active",
  createdAt,
  url,
  activities: { nodes: [{ updatedAt: new Date().toISOString() }] },
});

const invoke = async (event: unknown) => {
  const req = new Request("http://localhost/eve/v1/linear", {
    method: "POST",
    body: JSON.stringify(event),
    headers: {
      "linear-delivery": "delivery-1",
      "linear-event": "AgentSession",
    },
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
    reset();

    const response = await invoke(promptedEvent);

    expect(response.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["cancel", "send"]);
  });

  it("also cancels before dispatching a created webhook", async () => {
    reset();

    const response = await invoke(createdEvent);

    expect(response.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["cancel", "advance", "send"]);
  });

  it("cancels with the continuation token for the event's agent session id", async () => {
    reset();

    await invoke(promptedEvent);

    expect(cancelMock).toHaveBeenCalledWith({
      continuationToken: `agent-session:${agentSession.id}`,
    });
  });

  it("returns 401 and never dispatches when the webhook fails verification", async () => {
    webhookVerifier.mockResolvedValue(false);
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
    webhookVerifier.mockResolvedValue(true);
  });
});

describe("human-to-agent stop signal (HAR-39)", () => {
  it("cancels the turn and posts a response activity without dispatching on stop signal", async () => {
    reset();

    await invoke(stoppedEvent);

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith({
      continuationToken: "agent-session:sess-1",
    });
    expect(sendMock).not.toHaveBeenCalled();
    const activity = activities().at(-1);
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
  it("declines a created session when an older session is already live on the issue", async () => {
    reset();
    liveSessionNodes = [
      liveSession(
        "sess-0",
        "2026-07-25T10:00:00.000Z",
        "https://linear.app/sess-0",
      ),
      liveSession(
        "sess-1",
        "2026-07-25T11:00:00.000Z",
        "https://linear.app/sess-1",
      ),
    ];

    await invoke(createdEvent);

    // The wrapper cancels ahead of eve's dispatch, so a declined duplicate
    // still cancels - against its own continuation token, which owns no turn.
    expect(cancelMock).toHaveBeenCalledWith({
      continuationToken: "agent-session:sess-1",
    });
    expect(sendMock).not.toHaveBeenCalled();
    const activity = activities().at(-1);
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
    liveSessionNodes = [
      liveSession(
        "sess-1",
        "2026-07-25T10:00:00.000Z",
        "https://linear.app/sess-1",
      ),
      liveSession(
        "sess-9",
        "2026-07-25T11:00:00.000Z",
        "https://linear.app/sess-9",
      ),
    ];

    await invoke(createdEvent);

    expect(order).toEqual(["cancel", "advance", "send"]);
  });

  it("never guards prompted events", async () => {
    reset();

    await invoke(promptedEvent);

    expect(graphql.map((call) => call.queryName)).not.toContain(
      "IssueLiveAgentSessions",
    );
    expect(order).toEqual(["cancel", "send"]);
  });
});

describe("issue lifecycle sync on dispatch", () => {
  it("moves the issue to In Progress after dispatching a created session", async () => {
    reset();

    await invoke(createdEvent);

    expect(advanceIssueStateMock).toHaveBeenCalledTimes(1);
    expect(advanceIssueStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ issueRef: "issue-1", target: "inProgress" }),
    );
    expect(order).toEqual(["cancel", "advance", "send"]);
  });

  it("never syncs on prompted events", async () => {
    reset();

    await invoke(promptedEvent);

    expect(advanceIssueStateMock).not.toHaveBeenCalled();
  });

  it("never syncs a guard-declined duplicate session", async () => {
    reset();
    liveSessionNodes = [
      liveSession("sess-0", "2026-07-25T10:00:00.000Z", null),
    ];

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

describe("inbound image dispatch", () => {
  it("sends the Linear upload as an inline image part, and still cancels first", async () => {
    reset();

    await invoke(
      webhook({
        action: "prompted",
        agentActivity: {
          id: "activity-1",
          content: {
            body: "see ![](https://uploads.linear.app/abc/shot.png)",
            type: "prompt",
          },
        },
      }),
    );

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

// `handoff` posts the marker; the route retires the session it names so eve's
// dispatch re-creates it empty. The session id in the marker is the whole
// idempotency story, so these cover both directions of that comparison.
describe("agent/channels/linear (context-checkpoint rotation)", () => {
  const checkpoint = (eveSessionId: string) =>
    `<!-- eve-checkpoint session=${eveSessionId} -->\n\nPR #12 open; next: review`;

  const promptedWith = (previousComments: readonly string[]) =>
    webhook({
      action: "prompted",
      agentActivity: {
        id: "activity-1",
        content: { body: "review came back", type: "prompt" },
      },
      previousComments,
    });

  it("retires the checkpointed session before eve dispatches, so the send starts fresh", async () => {
    reset();
    resolveActiveSessionMock.mockResolvedValue({ sessionId: "eve-1" });

    await invoke(promptedWith(["earlier chatter", checkpoint("eve-1")]));

    expect(resetMock).toHaveBeenCalledWith({
      continuationToken: "agent-session:sess-1",
      reason: "context checkpoint",
    });
    // Reset has to land between the steering cancel and eve's send: after it,
    // so a live turn is stopped first; before it, so the send is what re-creates
    // the session empty.
    expect(order).toEqual(["cancel", "reset", "send"]);
  });

  it("leaves an unmarked thread alone and never looks a session up", async () => {
    reset();

    await invoke(promptedWith(["just a comment"]));

    expect(resolveActiveSessionMock).not.toHaveBeenCalled();
    expect(resetMock).not.toHaveBeenCalled();
    expect(order).toEqual(["cancel", "send"]);
  });

  it("is a no-op once rotated, so a second message cannot wipe the fresh session", async () => {
    reset();
    // The token now belongs to the post-rotation session, not the one the
    // checkpoint named.
    resolveActiveSessionMock.mockResolvedValue({ sessionId: "eve-2" });

    await invoke(promptedWith([checkpoint("eve-1")]));

    expect(resetMock).not.toHaveBeenCalled();
    expect(order).toEqual(["cancel", "send"]);
  });

  it("does not rotate when the token owns no session at all", async () => {
    reset();
    resolveActiveSessionMock.mockResolvedValue(undefined);

    await invoke(promptedWith([checkpoint("eve-1")]));

    expect(resetMock).not.toHaveBeenCalled();
  });

  it("dispatches anyway when the reset fails, leaving the old context in place", async () => {
    reset();
    resolveActiveSessionMock.mockResolvedValue({ sessionId: "eve-1" });
    resetMock.mockRejectedValueOnce(new Error("runtime unavailable"));

    const response = await invoke(promptedWith([checkpoint("eve-1")]));

    expect(response.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does not rotate on a stop signal, which dispatches nothing to rotate into", async () => {
    reset();
    resolveActiveSessionMock.mockResolvedValue({ sessionId: "eve-1" });

    await invoke(
      webhook({
        action: "prompted",
        agentActivity: {
          id: "activity-1",
          content: { body: "stop", type: "prompt" },
          signal: "stop",
        },
        previousComments: [checkpoint("eve-1")],
      }),
    );

    expect(resetMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

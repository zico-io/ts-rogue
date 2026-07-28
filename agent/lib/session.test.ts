import { describe, expect, it } from "vitest";

import type { ChannelRenderer } from "./channel";
import {
  AgentSession,
  type SessionScratch,
  type SessionUpdate,
} from "./session";
import type {
  ActionRequest,
  ActionResultData,
  InputRequest,
} from "./session-event";

interface Channel {
  readonly scratch: SessionScratch;
}

/**
 * The lifecycle under test, with rendering reduced to a list. What each channel
 * does with these updates is its own test's job (src/{linear-channel,
 * github-agent}.test.ts); this file is only about what the session decides.
 */
const recordingRenderer = (updates: SessionUpdate[]) => ({
  restartHint: "Start over.",
  async render(update: SessionUpdate): Promise<void> {
    updates.push(update);
  },
});

const setup = () => {
  const updates: SessionUpdate[] = [];
  const renderer: ChannelRenderer<Channel> = {
    ...recordingRenderer(updates),
    scratch: (channel) => channel.scratch,
  };
  return {
    channel: { scratch: {} as SessionScratch },
    session: new AgentSession(renderer),
    updates,
  };
};

const bashAction = {
  callId: "c1",
  input: { command: "git status" },
  kind: "tool-call",
  toolName: "bash",
} satisfies ActionRequest;

describe("turn.started", () => {
  it("announces the turn transiently and clears stale buffered narration", async () => {
    const { channel, session, updates } = setup();
    channel.scratch.pendingToolCallMessage = "left over";

    await session.turnStarted(channel);

    expect(updates).toEqual([
      { body: "Working on this.", kind: "thought", transient: true },
    ]);
    expect(channel.scratch.pendingToolCallMessage).toBeNull();
  });
});

describe("message.completed", () => {
  it("buffers the full narration ahead of a tool call rather than replying (HAR-78)", async () => {
    const { channel, session, updates } = setup();
    const proposal = "Creating these tickets:\n1. One\n2. Two";

    await session.messageCompleted(
      { finishReason: "tool-calls", message: proposal },
      channel,
    );

    expect(updates).toEqual([]);
    expect(channel.scratch.pendingToolCallMessage).toBe(proposal);
  });

  it("replies with the header stripped and clears the buffer", async () => {
    const { channel, session, updates } = setup();
    channel.scratch.pendingToolCallMessage = "stale";

    await session.messageCompleted(
      { finishReason: "stop", message: "## Update\n\nFixed as requested." },
      channel,
    );

    expect(updates).toEqual([
      { body: "Fixed as requested.", kind: "response" },
    ]);
    expect(channel.scratch.pendingToolCallMessage).toBeNull();
  });

  it("says nothing for an empty completion", async () => {
    const { channel, session, updates } = setup();

    await session.messageCompleted(
      { finishReason: "stop", message: null },
      channel,
    );

    expect(updates).toEqual([]);
  });

  it("forgets buffered narration when the renderer keeps no scratch", async () => {
    const updates: SessionUpdate[] = [];
    const session = new AgentSession<Channel>(recordingRenderer(updates));
    const channel = { scratch: {} as SessionScratch };

    await session.messageCompleted(
      { finishReason: "tool-calls", message: "narration" },
      channel,
    );
    await session.actionsRequested({ actions: [bashAction] }, channel);

    expect(updates).toEqual([
      {
        action: "Bash",
        kind: "action",
        parameter: "git status",
        transient: true,
      },
    ]);
  });
});

describe("actions.requested", () => {
  it("flushes buffered narration durably ahead of the transient chip (HAR-68)", async () => {
    const { channel, session, updates } = setup();
    channel.scratch.pendingToolCallMessage = "Let me check the git status.";

    await session.actionsRequested({ actions: [bashAction] }, channel);

    expect(updates).toEqual([
      { body: "Let me check the git status.", kind: "thought" },
      {
        action: "Bash",
        kind: "action",
        parameter: "git status",
        transient: true,
      },
    ]);
    expect(channel.scratch.pendingToolCallMessage).toBeNull();
  });

  it("stashes the chip by callId so its result can be paired later", async () => {
    const { channel, session } = setup();

    await session.actionsRequested({ actions: [bashAction] }, channel);

    expect(channel.scratch.pendingActionsByCallId).toEqual({
      c1: { action: "Bash", parameter: "git status" },
    });
  });

  it("collapses a parallel batch into one chip and stashes none of them", async () => {
    const { channel, session, updates } = setup();

    await session.actionsRequested(
      {
        actions: [
          bashAction,
          { ...bashAction, callId: "c2", toolName: "read" },
        ],
      },
      channel,
    );

    expect(updates).toEqual([
      {
        action: "Running",
        kind: "action",
        parameter: "Bash, Read",
        transient: true,
      },
    ]);
    expect(channel.scratch.pendingActionsByCallId).toBeUndefined();
  });

  it("says nothing at all for an empty batch with no buffered narration", async () => {
    const { channel, session, updates } = setup();

    await session.actionsRequested({ actions: [] }, channel);

    expect(updates).toEqual([]);
  });
});

describe("action.result", () => {
  const completedBash = {
    result: {
      callId: "c1",
      kind: "tool-result",
      output: { stdout: "hello" },
      toolName: "bash",
    },
    status: "completed",
  } satisfies Pick<ActionResultData, "result" | "status">;

  it("promotes the stashed chip to a durable one carrying the result", async () => {
    const { channel, session, updates } = setup();
    channel.scratch.pendingActionsByCallId = {
      c1: { action: "Bash", parameter: "git status" },
    };

    await session.actionResult(completedBash, channel);

    expect(updates).toEqual([
      {
        action: "Bash",
        kind: "action",
        parameter: "git status",
        result: "✓ done · 1 line",
      },
    ]);
  });

  it("consumes the stash, so a repeated result posts nothing", async () => {
    const { channel, session, updates } = setup();
    channel.scratch.pendingActionsByCallId = {
      c1: { action: "Bash", parameter: "git status" },
    };

    await session.actionResult(completedBash, channel);
    await session.actionResult(completedBash, channel);

    expect(updates).toHaveLength(1);
    expect(channel.scratch.pendingActionsByCallId).toEqual({});
  });

  it("reports the error message instead of the output when the call failed", async () => {
    const { channel, session, updates } = setup();
    channel.scratch.pendingActionsByCallId = {
      c1: { action: "Bash", parameter: "git status" },
    };

    await session.actionResult(
      {
        ...completedBash,
        error: { code: "tool_execution_failed", message: "Command not found" },
        status: "failed",
      },
      channel,
    );

    expect(updates[0]).toMatchObject({ result: "Command not found" });
  });

  it("posts nothing for an untracked callId", async () => {
    const { channel, session, updates } = setup();

    await session.actionResult(completedBash, channel);

    expect(updates).toEqual([]);
  });

  it("emits the plan a todo result carries, without needing a stashed chip", async () => {
    const { channel, session, updates } = setup();

    await session.actionResult(
      {
        result: {
          callId: "c9",
          kind: "tool-result",
          output: {
            todos: [
              { content: "Ship it", priority: "high", status: "in_progress" },
            ],
          },
          toolName: "todo",
        },
        status: "completed",
      },
      channel,
    );

    expect(updates).toEqual([
      { kind: "plan", steps: [{ content: "Ship it", status: "inProgress" }] },
    ]);
  });
});

describe("input.requested", () => {
  it("passes the requests through untouched for the channel to render natively", async () => {
    const { channel, session, updates } = setup();
    const requests: readonly InputRequest[] = [
      { action: bashAction, prompt: "Approve?", requestId: "req-1" },
    ];

    await session.inputRequested({ requests }, channel);

    expect(updates).toEqual([{ kind: "inputPrompt", requests }]);
  });
});

describe("authorization.required", () => {
  it("names the connection, keeps the URL structured, and codes the user code", async () => {
    const { channel, session, updates } = setup();

    await session.authorizationRequired(
      {
        authorization: {
          displayName: "Linear MCP",
          instructions: "Approve the sign-in request on your phone.",
          url: "https://example.com/oauth",
          userCode: "ABCD-1234",
        },
        name: "linear",
      },
      channel,
    );

    expect(updates).toEqual([
      {
        body: [
          "I need Linear MCP connected before I can continue.",
          "",
          "Approve the sign-in request on your phone.",
          "",
          "Code: `ABCD-1234`",
        ].join("\n"),
        displayName: "Linear MCP",
        kind: "authPrompt",
        url: "https://example.com/oauth",
      },
    ]);
  });

  it("title-cases a connection with no display name and omits an absent URL", async () => {
    const { channel, session, updates } = setup();

    await session.authorizationRequired({ name: "vercel" }, channel);

    expect(updates).toEqual([
      {
        body: "I need Vercel connected before I can continue.",
        displayName: "Vercel",
        kind: "authPrompt",
      },
    ]);
  });

  it("reads a slug-style connection name as separate words", async () => {
    const { channel, session, updates } = setup();

    await session.authorizationRequired(
      { name: "linear/ts-rogue-eve" },
      channel,
    );
    await session.authorizationRequired(
      { authorization: null, name: "github_app" },
      channel,
    );

    expect(
      updates.map((u) => (u.kind === "authPrompt" ? u.displayName : "")),
    ).toEqual(["Linear Ts Rogue Eve", "Github App"]);
  });
});

describe("authorization.completed", () => {
  it("notes a successful connection transiently", async () => {
    const { channel, session, updates } = setup();

    await session.authorizationCompleted(
      {
        authorization: { displayName: "Linear MCP" },
        name: "linear",
        outcome: "authorized",
      },
      channel,
    );

    expect(updates).toEqual([
      {
        body: "Connected to Linear MCP. Resuming.",
        kind: "thought",
        transient: true,
      },
    ]);
  });

  it("keeps a failed outcome and its reason durable", async () => {
    const { channel, session, updates } = setup();

    await session.authorizationCompleted(
      { name: "linear", outcome: "timed-out", reason: "challenge expired" },
      channel,
    );

    expect(updates).toEqual([
      {
        body: "Authorization for Linear timed out: challenge expired",
        kind: "thought",
      },
    ]);
  });

  // Only `timed-out` needs rewording; eve's other outcomes are already prose.
  it("passes an outcome that already reads as prose straight through", async () => {
    const { channel, session, updates } = setup();

    await session.authorizationCompleted(
      { name: "linear", outcome: "declined" },
      channel,
    );

    expect(updates).toEqual([
      { body: "Authorization for Linear declined.", kind: "thought" },
    ]);
  });

  it("words eve's remaining outcome the same way", async () => {
    const { channel, session, updates } = setup();

    await session.authorizationCompleted(
      { name: "linear", outcome: "failed" },
      channel,
    );

    expect(updates).toEqual([
      { body: "Authorization for Linear failed.", kind: "thought" },
    ]);
  });
});

describe("failures", () => {
  it("uses the channel's own restart wording on an unrecoverable session", async () => {
    const { channel, session, updates } = setup();

    await session.sessionFailed(
      { details: { errorId: "err-1" }, message: "boom" },
      channel,
    );

    const [update] = updates;
    expect(update?.kind).toBe("error");
    const body = update?.kind === "error" ? update.body : "";
    expect(body).toContain("could not recover");
    expect(body).toContain("Start over.");
    expect(body).toContain("Error id: err-1");
    // A renderer with something to do about a dead session needs to tell the
    // two failures apart; Linear moves the issue to blocked on this one.
    expect(update?.kind === "error" && update.fatal).toBe(true);
  });

  it("invites a retry on a recoverable turn failure", async () => {
    const { channel, session, updates } = setup();

    await session.turnFailed({ details: {}, message: "boom" }, channel);

    const [update] = updates;
    expect(update?.kind).toBe("error");
    expect(update?.kind === "error" ? update.body : "").toContain(
      "Please try again",
    );
    expect(update?.kind === "error" && update.fatal).toBeUndefined();
  });
});

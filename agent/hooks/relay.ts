import { connectLinearCredentials } from "@vercel/connect/eve";
import {
  callLinearGraphQL,
  createLinearAgentActivity,
  createLinearAgentSessionOnIssue,
} from "eve/channels/linear";
import { defineState } from "eve/context";
import { defineHook, type HookContext } from "eve/hooks";

import { MIRROR_MARKER } from "../lib/mirror-session";
import type { PendingAction } from "../lib/pending-action";
import { toolActionParameter, toolActionResult } from "../lib/tool-activity";
import { toolLabel } from "../lib/tool-label";
import { MAX_ACTIVITY_TEXT_LENGTH, truncate } from "../lib/truncate";

// Runs in both root and child sessions.
// Root: when a turn delegates, persists the Linear agent session id to a
// shared-sandbox file so children can read it (written before any child event
// fires, because hook handlers are awaited before children are dispatched).
// Child: relays tool calls, reasoning, and the final message into a per-child
// "mirror" Agent Session - its own top-level Linear card (see the mirror-session
// section below) - falling back to the parent session if the mirror can't be
// created.

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

// linearContinuationToken() format; a token without it (e.g. a merge-woken
// GitHub session) has no Linear agent session to post to.
const LINEAR_CONTINUATION_PREFIX = "agent-session:";

/** Shared-sandbox handoff file: root writes the Linear agent session id, children read it. */
export const SESSION_ID_FILE = "/workspace/.eve/linear-agent-session";

const relay = defineState<{
  agentSessionId: string | null;
  mirrorSessionId: string | null;
  mirrorFailed: boolean;
  issueId: string | null;
  sandboxChecked: boolean;
  warnedDark: boolean;
  pendingActions: Record<string, PendingAction>;
}>("ts-rogue.relay", () => ({
  agentSessionId: null,
  mirrorSessionId: null,
  mirrorFailed: false,
  issueId: null,
  sandboxChecked: false,
  warnedDark: false,
  pendingActions: {},
}));

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const parseAgentSessionId = (text: string): string | null =>
  text.match(/agent_session_id["`\s:=]+([\w-]+)/)?.[1] ?? null;

export const parseIssueId = (text: string): string | null =>
  text
    .match(/\bissue["`\s:=]+([A-Za-z][A-Za-z0-9]*-\d+)\b/)?.[1]
    ?.toUpperCase() ?? null;

const capturePacketFacts = (text: string) => {
  const state = relay.get();
  const agentSessionId = state.agentSessionId ?? parseAgentSessionId(text);
  const issueId = state.issueId ?? parseIssueId(text);
  if (agentSessionId !== state.agentSessionId || issueId !== state.issueId) {
    relay.update((s) => ({ ...s, agentSessionId, issueId }));
  }
};

/** The delegated issue this child is working, for other child-scoped surfaces (tools/session_update prefixes with it). */
export const relayIssueId = (): string | null => relay.get().issueId;

type ActivityContent = Parameters<
  typeof createLinearAgentActivity
>[0]["activity"]["content"];

const persistSessionIdForChildren = async (
  actions: readonly { kind: string }[],
  ctx: HookContext,
) => {
  const token = ctx.channel?.continuationToken;
  if (!token?.startsWith(LINEAR_CONTINUATION_PREFIX)) return;
  if (!actions.some((action) => action.kind === "subagent-call")) return;
  try {
    const sandbox = await ctx.getSandbox();
    await sandbox.writeTextFile({
      path: SESSION_ID_FILE,
      content: token.slice(LINEAR_CONTINUATION_PREFIX.length),
    });
  } catch (err) {
    console.warn(
      "relay: persisting the Linear session id for children failed:",
      errorMessage(err),
    );
  }
};

// Checked once per child session; a missing file means no Linear session to
// relay to (e.g. a non-Linear wake), and the one-time warning keeps a dark
// relay diagnosable instead of silent.
const ensureAgentSessionId = async (ctx: HookContext) => {
  const state = relay.get();
  if (state.agentSessionId || state.sandboxChecked) return;
  relay.update((s) => ({ ...s, sandboxChecked: true }));
  try {
    const sandbox = await ctx.getSandbox();
    const read = await sandbox.run({
      command: `cat ${SESSION_ID_FILE} 2>/dev/null || true`,
    });
    const id = read.stdout.trim();
    if (id) {
      relay.update((s) => ({ ...s, agentSessionId: s.agentSessionId ?? id }));
      return;
    }
  } catch (err) {
    console.warn(
      "relay: reading the Linear session id handoff file failed:",
      errorMessage(err),
    );
  }
  if (!relay.get().agentSessionId && !relay.get().warnedDark) {
    relay.update((s) => ({ ...s, warnedDark: true }));
    console.warn(
      "relay: no Linear agent session id (delegation text lacked agent_session_id and no handoff file) - this child's activity will not stream to Linear",
    );
  }
};

const post = async (
  agentSessionId: string | null,
  content: ActivityContent,
  options: { ephemeral?: boolean; prefix?: boolean } = {},
) => {
  if (!agentSessionId) return;
  const body = options.prefix
    ? withIssuePrefix(content, relay.get().issueId)
    : content;
  try {
    await createLinearAgentActivity({
      credentials,
      activity: { agentSessionId, content: body, ephemeral: options.ephemeral },
    });
  } catch (err) {
    // Observe-only: a Linear hiccup must never fail the child's turn.
    console.warn("relay: posting a Linear activity failed:", errorMessage(err));
  }
};

// --- Per-child mirror session ------------------------------------------------
// Each delegated child gets its OWN top-level Linear card so its work reads as
// a sibling "Working" block instead of nesting under the parent's turn (Linear
// folds every `thought`/`action` under the receiving session's open block, so a
// separate session is the only way to a separate top-level block). The mirror
// is created lazily on the child's first relayed activity and closed by the
// child's final narration. It carries `MIRROR_MARKER` so the channel declines
// its dispatch and `lib/live-sessions.ts` never counts it against the
// one-live-session-per-issue guard. See `agent/README.md`.

// One creation in flight per child session id: concurrent handlers in the same
// turn await the same promise instead of racing two AgentSessionCreate calls.
const mirrorCreations = new Map<string, Promise<string | null>>();

// The mirror is created on the issue (`createLinearAgentSessionOnIssue` needs
// the issue UUID, not the identifier the relay parses for chip prefixes), read
// off the parent session rather than the delegation text - which, like the
// agent session id, may not carry it (see `ensureAgentSessionId`).
const fetchIssueUuid = async (
  parentAgentSessionId: string,
): Promise<string | null> => {
  const data = await callLinearGraphQL<{
    agentSession?: { issue?: { id?: string } };
  }>({
    credentials,
    query: `
      query AgentSessionIssue($id: String!) {
        agentSession(id: $id) { issue { id } }
      }
    `,
    queryName: "AgentSessionIssue",
    variables: { id: parentAgentSessionId },
  });
  const id = data.agentSession?.issue?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
};

const createMirrorSession = async (
  parentAgentSessionId: string,
): Promise<string | null> => {
  try {
    const issueId = await fetchIssueUuid(parentAgentSessionId);
    if (!issueId) return null;
    const session = await createLinearAgentSessionOnIssue({
      credentials,
      issueId,
      externalUrls: [MIRROR_MARKER],
    });
    return typeof session.id === "string" && session.id.length > 0
      ? session.id
      : null;
  } catch (err) {
    console.warn(
      "relay: creating the child's mirror Agent Session failed:",
      errorMessage(err),
    );
    return null;
  }
};

// Returns this child's mirror session id, creating it once, or null when it
// can't be created yet (no known parent session) or at all (creation failed -
// callers fall back to posting into the parent session).
const ensureMirrorSessionId = async (
  ctx: HookContext,
): Promise<string | null> => {
  const state = relay.get();
  if (state.mirrorSessionId) return state.mirrorSessionId;
  // Give up permanently for this child once creation fails, so a Linear outage
  // becomes one fallback-to-parent, not a create attempt on every activity.
  if (state.mirrorFailed) return null;
  const parentId = state.agentSessionId;
  if (!parentId) return null; // parent id may still arrive; not a failure
  let creation = mirrorCreations.get(ctx.session.id);
  if (!creation) {
    creation = createMirrorSession(parentId);
    mirrorCreations.set(ctx.session.id, creation);
  }
  // createMirrorSession never throws (it catches and returns null). Persist
  // before clearing the memo so a late concurrent caller sees the resolved id
  // instead of starting a second create.
  const id = await creation;
  relay.update((s) => ({
    ...s,
    mirrorSessionId: s.mirrorSessionId ?? id,
    mirrorFailed: s.mirrorFailed || id === null,
  }));
  mirrorCreations.delete(ctx.session.id);
  return relay.get().mirrorSessionId;
};

// Routes a child's routine activity to its own mirror card (no issue prefix -
// the card is already per-child), falling back to the parent session (prefixed,
// so parallel children stay attributable) when no mirror exists.
const relayTo = async (
  ctx: HookContext,
  content: ActivityContent,
  options: { ephemeral?: boolean } = {},
) => {
  const mirrorId = await ensureMirrorSessionId(ctx);
  if (mirrorId) {
    await post(mirrorId, content, { ephemeral: options.ephemeral });
    return;
  }
  await post(relay.get().agentSessionId, content, {
    ephemeral: options.ephemeral,
    prefix: true,
  });
};

// Prefix relayed content with the child's issue so parallel children posting
// into the same session stay tellable apart.
const withIssuePrefix = (
  content: ActivityContent,
  issueId: string | null,
): ActivityContent => {
  if (!issueId) return content;
  if ("body" in content) {
    return { ...content, body: `[${issueId}] ${content.body}` };
  }
  if ("action" in content) {
    return { ...content, action: `[${issueId}] ${content.action}` };
  }
  return content;
};

export default defineHook({
  events: {
    async "message.received"(event, ctx) {
      if (!ctx.session.parent) return;
      capturePacketFacts(event.data.message);
      await ensureAgentSessionId(ctx);
    },
    async "actions.requested"(event, ctx) {
      if (!ctx.session.parent) {
        await persistSessionIdForChildren(event.data.actions, ctx);
        return;
      }
      await ensureAgentSessionId(ctx);
      for (const action of event.data.actions) {
        if (action.kind !== "tool-call") continue;
        if (action.toolName.endsWith("session_update")) {
          // The child echoes the id here even if the delegation text lacked it.
          const id = action.input.agentSessionId;
          if (typeof id === "string" && id && !relay.get().agentSessionId) {
            relay.update((s) => ({ ...s, agentSessionId: id }));
          }
          continue; // session_update already posts its own activity
        }
        const label = toolLabel(action.toolName);
        const parameter = toolActionParameter(action.toolName, action.input);
        relay.update((s) => ({
          ...s,
          pendingActions: {
            ...s.pendingActions,
            [action.callId]: { action: label, parameter },
          },
        }));
        await relayTo(
          ctx,
          { type: "action", action: label, parameter },
          { ephemeral: true },
        );
      }
    },
    async "reasoning.completed"(event, ctx) {
      if (!ctx.session.parent) return;
      const reasoning = event.data.reasoning?.trim();
      if (reasoning)
        await relayTo(
          ctx,
          { type: "thought", body: reasoning },
          {
            ephemeral: true,
          },
        );
    },
    async "message.completed"(event, ctx) {
      if (!ctx.session.parent) return;
      const text = event.data.message?.trim();
      if (!text) return;
      // Mid-batch narration (the model spoke before a tool call) is transient,
      // shown live in the card; only the child's final message closes it.
      if (event.data.finishReason === "tool-calls") {
        await relayTo(
          ctx,
          { type: "thought", body: text },
          { ephemeral: true },
        );
        return;
      }
      // The final narration concludes the mirror card. A `response` is the only
      // activity type that ends a Linear session, so the card lands "complete"
      // rather than a perpetual "Working". The parent fallback stays a durable
      // `thought` - never a `response`, which would wrongly flip the parent
      // session itself to finished (the HAR-38 failure mode).
      const mirrorId = await ensureMirrorSessionId(ctx);
      if (mirrorId) {
        await post(mirrorId, { type: "response", body: text });
        return;
      }
      await post(
        relay.get().agentSessionId,
        { type: "thought", body: text },
        {
          prefix: true,
        },
      );
    },
    async "action.result"(event, ctx) {
      if (!ctx.session.parent) return;
      if (event.data.result.kind !== "tool-result") return;
      const pending = relay.get().pendingActions[event.data.result.callId];
      if (!pending) return;
      relay.update((s) => {
        const { [event.data.result.callId]: _, ...rest } = s.pendingActions;
        return { ...s, pendingActions: rest };
      });
      const rawResult = event.data.error?.message
        ? event.data.error.message
        : toolActionResult(
            event.data.result.toolName,
            event.data.result.output,
            event.data.result.isError,
          );
      await relayTo(ctx, {
        type: "action",
        action: pending.action,
        parameter: pending.parameter,
        result: truncate(rawResult, MAX_ACTIVITY_TEXT_LENGTH),
      });
    },
  },
});

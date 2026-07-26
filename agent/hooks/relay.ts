import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineState } from "eve/context";
import { defineHook, type HookContext } from "eve/hooks";

import type { PendingAction } from "../lib/pending-action";
import { toolLabel } from "../lib/tool-label";
import { MAX_ACTIVITY_TEXT_LENGTH, truncate } from "../lib/truncate";

// Runs in both root and child sessions.
// Root: when a turn delegates, persists the Linear agent session id to a
// shared-sandbox file so children can read it (written before any child event
// fires, because hook handlers are awaited before children are dispatched).
// Child: relays tool calls, reasoning, and the final message to the parent's
// Linear Agent Session as ephemeral "working" chips.

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

// linearContinuationToken() format; a token without it (e.g. a merge-woken
// GitHub session) has no Linear agent session to post to.
const LINEAR_CONTINUATION_PREFIX = "agent-session:";

/** Shared-sandbox handoff file: root writes the Linear agent session id, children read it. */
export const SESSION_ID_FILE = "/workspace/.eve/linear-agent-session";

const relay = defineState<{
  agentSessionId: string | null;
  issueId: string | null;
  sandboxChecked: boolean;
  warnedDark: boolean;
  pendingActions: Record<string, PendingAction>;
}>("ts-rogue.relay", () => ({
  agentSessionId: null,
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
  content: ActivityContent,
  options: { ephemeral?: boolean } = {},
) => {
  const { agentSessionId, issueId } = relay.get();
  if (!agentSessionId) return;
  try {
    await createLinearAgentActivity({
      credentials,
      activity: {
        agentSessionId,
        content: withIssuePrefix(content, issueId),
        ephemeral: options.ephemeral,
      },
    });
  } catch (err) {
    // Observe-only: a Linear hiccup must never fail the child's turn.
    console.warn(
      "relay: posting a Linear activity failed:",
      errorMessage(err),
    );
  }
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
        const raw = JSON.stringify(action.input);
        const label = toolLabel(action.toolName);
        const parameter = truncate(raw, MAX_ACTIVITY_TEXT_LENGTH);
        relay.update((s) => ({
          ...s,
          pendingActions: {
            ...s.pendingActions,
            [action.callId]: { action: label, parameter },
          },
        }));
        await post(
          { type: "action", action: label, parameter },
          { ephemeral: true },
        );
      }
    },
    async "reasoning.completed"(event, ctx) {
      if (!ctx.session.parent) return;
      const reasoning = event.data.reasoning?.trim();
      if (reasoning)
        await post({ type: "thought", body: reasoning }, { ephemeral: true });
    },
    async "message.completed"(event, ctx) {
      if (!ctx.session.parent) return;
      const text = event.data.message?.trim();
      if (text) await post({ type: "thought", body: text });
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
      let rawResult: string;
      if (event.data.error?.message) {
        rawResult = event.data.error.message;
      } else {
        try {
          rawResult = JSON.stringify(event.data.result.output);
        } catch {
          rawResult = "";
        }
      }
      await post(
        {
          type: "action",
          action: pending.action,
          parameter: pending.parameter,
          result: truncate(rawResult, MAX_ACTIVITY_TEXT_LENGTH),
        },
        {},
      );
    },
  },
});

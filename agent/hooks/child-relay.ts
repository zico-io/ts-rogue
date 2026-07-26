import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineState } from "eve/context";
import { defineHook, type HookContext } from "eve/hooks";

import type { PendingAction } from "../lib/pending-action";
import { toolLabel } from "../lib/tool-label";
import { MAX_ACTIVITY_TEXT_LENGTH, truncate } from "../lib/truncate";

// The built-in `agent` child runs in its own session and stream, so its work
// never reaches the Linear channel. This hook is a copy of the root's hooks
// running inside the child, so it sees the child's own events and relays them to
// the same Linear Agent Session as they happen.
//
// The same hook also runs in the ROOT session, where it has one job: the
// moment a turn requests a `subagent-call`, persist the Linear agent session
// id to a file in the shared sandbox (children share the root's sandbox).
// That makes the child's session-id handoff deterministic instead of relying
// on the model to copy `agent_session_id` into the delegation prose - the
// failure mode that left ENG-2's ephemeral chip frozen for a whole child run.
// Hook handlers are awaited before the runtime dispatches the children, so
// the file exists before any child event fires.
//
// (A `subagent.called` hook would be the natural trigger, but eve never
// dispatches that event to authored hooks or channel adapters despite
// declaring it in the hook vocabulary - verified against eve's dist:
// dispatch-runtime-actions-step writes it to the stream and calls only the
// framework channel adapter, and defineChannel filters authored event maps
// through an allowlist without it. Hence the actions.requested trigger.)

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

// linearContinuationToken() format; a token without it (e.g. a merge-woken
// GitHub session) has no Linear agent session to post to.
const LINEAR_CONTINUATION_PREFIX = "agent-session:";

/** Shared-sandbox handoff file: root writes the Linear agent session id, children read it. */
export const SESSION_ID_FILE = "/workspace/.eve/linear-agent-session";

// Fresh per child session; captures the Linear agent session id and the
// delegated issue identifier from the text the parent hands the child (ctx
// exposes no Linear id of its own). `sandboxChecked`/`warnedDark` latch the
// one-time handoff-file fallback and its diagnostic warning.
// `pendingActions` records tool-call metadata so a completed action.result
// can promote the ephemeral chip to a durable activity.
const relay = defineState<{
  agentSessionId: string | null;
  issueId: string | null;
  sandboxChecked: boolean;
  warnedDark: boolean;
  pendingActions: Record<string, PendingAction>;
}>("ts-rogue.child-relay", () => ({
  agentSessionId: null,
  issueId: null,
  sandboxChecked: false,
  warnedDark: false,
  pendingActions: {},
}));

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// The parent's delegation text carries the Linear session id in the framework
// context block (`agent_session_id: <id>`) or however the parent phrases it.
export const parseAgentSessionId = (text: string): string | null =>
  text.match(/agent_session_id["`\s:=]+([\w-]+)/)?.[1] ?? null;

// The delegation packet leads with `issue: <identifier> - <title>`. Ralph mode
// runs several children against one Linear session at once, so each relayed
// activity is prefixed with its issue to stay attributable.
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

// Root side of the handoff: persist the Linear agent session id where the
// children this batch is about to spawn can read it. Idempotent and cheap
// (one small file write per delegation batch); observe-only, so failures
// warn instead of failing the turn.
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
      "child-relay: persisting the Linear session id for children failed:",
      errorMessage(err),
    );
  }
};

// Child side of the handoff: when the delegation prose carried no
// `agent_session_id`, fall back to the file the root wrote. Checked once -
// the root's write completes before any child event fires, so a missing file
// means this child has no Linear session to relay to (e.g. a non-Linear
// wake), and the one-time warning makes a dark relay diagnosable instead of
// silent.
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
      "child-relay: reading the Linear session id handoff file failed:",
      errorMessage(err),
    );
  }
  if (!relay.get().agentSessionId && !relay.get().warnedDark) {
    relay.update((s) => ({ ...s, warnedDark: true }));
    console.warn(
      "child-relay: no Linear agent session id (delegation text lacked agent_session_id and no handoff file) - this child's activity will not stream to Linear",
    );
  }
};

// Working chips post as ephemeral: Linear shows an ephemeral activity only
// until the next activity arrives, so the session carries a single live
// "what the child is doing right now" slot instead of a growing wall of
// chips. The child's final report (message.completed) stays non-ephemeral so
// the handoff summary survives in the thread.
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
    // Observe-only: a Linear hiccup must never fail the child's turn - but
    // say so, or a relay that never posts is indistinguishable from one that
    // was never wired (HAR-11's first production outing was exactly that).
    console.warn(
      "child-relay: posting a Linear activity failed:",
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

import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineState } from "eve/context";
import { defineHook, type HookContext } from "eve/hooks";

import type { PendingAction } from "../lib/pending-action";
import { toolLabel } from "../lib/tool-label";
import {
  MAX_ACTIVITY_TEXT_LENGTH,
  truncatePreservingTrailingUrl,
} from "../lib/truncate";

// Surfaces each `agent()` call the `Workflow` tool dispatches from inside its
// one durable step (HAR-70). Without this, a human watching the Linear Agent
// Session sees only the step's opaque synthesized result. That is a
// regression against Linear's Agent Interaction Guidelines (meaningful
// intermediate state, not just start/finish).
//
// `subagent.called`/`subagent.completed` fire only for calls a running
// Workflow program dispatches (eve's protocol layer documents
// `subagent.called` as "the event for one started child workflow session").
// A direct (non-Workflow) `agent(...)` call already gets its own chip from
// the Linear channel's `actions.requested`/`action.result` pairing (kind
// `subagent-call`), so there is no double-posting between the two paths.

const credentials = connectLinearCredentials("linear/ts-rogue-eve");
const api = process.env.LINEAR_API_BASE_URL
  ? { apiBaseUrl: process.env.LINEAR_API_BASE_URL }
  : undefined;

// linearContinuationToken() format; a token without it (e.g. a merge-woken
// GitHub session) has no Linear agent session to post to.
const LINEAR_CONTINUATION_PREFIX = "agent-session:";

// Keyed by the workflow call's callId so `subagent.completed` (which carries
// no sequence) can echo the same action/parameter chip the ephemeral
// `subagent.called` chip already showed.
const pendingCalls = defineState<Record<string, PendingAction>>(
  "ts-rogue.workflow-progress",
  () => ({}),
);

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const agentSessionIdFromContext = (ctx: HookContext): string | null => {
  const token = ctx.channel?.continuationToken;
  return token?.startsWith(LINEAR_CONTINUATION_PREFIX)
    ? token.slice(LINEAR_CONTINUATION_PREFIX.length)
    : null;
};

type ActivityContent = Parameters<
  typeof createLinearAgentActivity
>[0]["activity"]["content"];

const post = async (
  agentSessionId: string,
  content: ActivityContent,
  options: { ephemeral?: boolean } = {},
) => {
  try {
    await createLinearAgentActivity({
      api,
      credentials,
      activity: {
        agentSessionId,
        content,
        ephemeral: options.ephemeral,
      },
    });
  } catch (err) {
    // Observe-only: a Linear hiccup must never fail the workflow step.
    console.warn(
      "workflow-progress: posting a Linear activity failed:",
      errorMessage(err),
    );
  }
};

export default defineHook({
  events: {
    async "subagent.called"(event, ctx) {
      const agentSessionId = agentSessionIdFromContext(ctx);
      if (agentSessionId === null) return;
      const action = toolLabel(event.data.name);
      const parameter = `Workflow call ${event.data.sequence + 1}`;
      pendingCalls.update((calls) => ({
        ...calls,
        [event.data.callId]: { action, parameter },
      }));
      await post(
        agentSessionId,
        { type: "action", action, parameter },
        { ephemeral: true },
      );
    },
    async "subagent.completed"(event, ctx) {
      const agentSessionId = agentSessionIdFromContext(ctx);
      if (agentSessionId === null) return;
      const pending = pendingCalls.get()[event.data.callId];
      pendingCalls.update((calls) => {
        const { [event.data.callId]: _, ...rest } = calls;
        return rest;
      });
      const action = pending?.action ?? toolLabel(event.data.subagentName);
      const parameter = pending?.parameter ?? "Workflow call";
      await post(agentSessionId, {
        type: "action",
        action,
        parameter,
        result: truncatePreservingTrailingUrl(
          event.data.output,
          MAX_ACTIVITY_TEXT_LENGTH,
        ),
      });
    },
  },
});

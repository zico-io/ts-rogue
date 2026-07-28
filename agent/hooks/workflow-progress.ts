import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";

import type { PendingAction, SessionUpdate } from "../lib/session";
import { toolLabel } from "../lib/tool-activity";

// Surfaces each `agent()` call the `Workflow` tool dispatches from inside its
// one durable step (HAR-70). Without this, a human watching the Agent Session
// sees only the step's opaque synthesized result. That is a regression against
// Linear's Agent Interaction Guidelines (meaningful intermediate state, not
// just start/finish).
//
// `subagent.called`/`subagent.completed` fire only for calls a running
// Workflow program dispatches (eve's protocol layer documents
// `subagent.called` as "the event for one started child workflow session").
// A direct (non-Workflow) `agent(...)` call already gets its own chip from
// the channel's `actions.requested`/`action.result` pairing (kind
// `subagent-call`), so there is no double-posting between the two paths.
//
// The handlers below post a channel-agnostic `SessionUpdate`; `postUpdate`
// below is the one place that knows which channel can show one from out here,
// where there is no channel context - only the token addressing the session.

// Linear is the only channel with an out-of-band posting surface; a session on
// any other shows nothing rather than failing the caller, since a hook is
// observe-only. The import is lazy so a session on another channel never drags
// Linear's Connect credentials into the process.
const postUpdate = async (
  channel: { readonly continuationToken?: string; readonly kind?: string },
  update: SessionUpdate,
): Promise<void> => {
  if (channel.kind !== "linear" || !channel.continuationToken) return;
  const { postLinearUpdate } = await import("../lib/linear/poster");
  await postLinearUpdate(channel.continuationToken, update);
};

// Keyed by the workflow call's callId so `subagent.completed` (which carries
// no sequence) can echo the same action/parameter chip the ephemeral
// `subagent.called` chip already showed.
const pendingCalls = defineState<Record<string, PendingAction>>(
  "ts-rogue.workflow-progress",
  () => ({}),
);

export default defineHook({
  events: {
    async "subagent.called"(event, ctx) {
      const action = toolLabel(event.data.name);
      const parameter = `Workflow call ${event.data.sequence + 1}`;
      pendingCalls.update((calls) => ({
        ...calls,
        [event.data.callId]: { action, parameter },
      }));
      await postUpdate(ctx.channel, {
        action,
        kind: "action",
        parameter,
        transient: true,
      });
    },
    async "subagent.completed"(event, ctx) {
      const pending = pendingCalls.get()[event.data.callId];
      pendingCalls.update((calls) => {
        const { [event.data.callId]: _, ...rest } = calls;
        return rest;
      });
      await postUpdate(ctx.channel, {
        action: pending?.action ?? toolLabel(event.data.subagentName),
        kind: "action",
        parameter: pending?.parameter ?? "Workflow call",
        result: event.data.output,
      });
    },
  },
});

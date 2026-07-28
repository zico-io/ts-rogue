import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";

import type { PendingAction, SessionUpdate } from "../lib/session";
import { toolLabel } from "../lib/tool-activity";

// Surfaces each `agent()` call a running `Workflow` step dispatches (HAR-70).
// Linear is the only channel with an out-of-band posting surface; the import is
// lazy so another channel's session never loads Linear's Connect credentials.
const postUpdate = async (
  channel: { readonly continuationToken?: string; readonly kind?: string },
  update: SessionUpdate,
): Promise<void> => {
  if (channel.kind !== "linear" || !channel.continuationToken) return;
  const { postLinearUpdate } = await import("../lib/linear/poster");
  await postLinearUpdate(channel.continuationToken, update);
};

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

import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineState } from "eve/context";
import { defineHook } from "eve/hooks";

import { toolLabel } from "../lib/tool-label";

// The built-in `agent` child runs in its own session and stream, so its work
// never reaches the Linear channel. This hook is a copy of the root's hooks
// running inside the child, so it sees the child's own events and relays them to
// the same Linear Agent Session as they happen.

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

// Fresh per child session; captures the Linear agent session id from the text the
// parent hands the child (ctx exposes no Linear id of its own).
const relay = defineState<{ agentSessionId: string | null }>(
  "ts-rogue.child-relay",
  () => ({ agentSessionId: null }),
);

// The parent's delegation text carries the Linear session id in the framework
// context block (`agent_session_id: <id>`) or however the parent phrases it.
export const parseAgentSessionId = (text: string): string | null =>
  text.match(/agent_session_id["`\s:=]+([\w-]+)/)?.[1] ?? null;

const captureAgentSessionId = (text: string) => {
  if (relay.get().agentSessionId) return;
  const id = parseAgentSessionId(text);
  if (id) relay.update((s) => ({ ...s, agentSessionId: id }));
};

const post = async (
  content: Parameters<
    typeof createLinearAgentActivity
  >[0]["activity"]["content"],
) => {
  const { agentSessionId } = relay.get();
  if (!agentSessionId) return;
  try {
    await createLinearAgentActivity({
      credentials,
      activity: { agentSessionId, content },
    });
  } catch {
    // Observe-only: a Linear hiccup must never fail the child's turn.
  }
};

const MAX_PARAMETER = 300;

export default defineHook({
  events: {
    async "message.received"(event, ctx) {
      if (!ctx.session.parent) return;
      captureAgentSessionId(event.data.message);
    },
    async "actions.requested"(event, ctx) {
      if (!ctx.session.parent) return;
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
        const parameter = JSON.stringify(action.input);
        await post({
          type: "action",
          action: toolLabel(action.toolName),
          parameter:
            parameter.length > MAX_PARAMETER
              ? `${parameter.slice(0, MAX_PARAMETER)}…`
              : parameter,
        });
      }
    },
    async "reasoning.completed"(event, ctx) {
      if (!ctx.session.parent) return;
      const reasoning = event.data.reasoning?.trim();
      if (reasoning) await post({ type: "thought", body: reasoning });
    },
    async "message.completed"(event, ctx) {
      if (!ctx.session.parent) return;
      const text = event.data.message?.trim();
      if (text) await post({ type: "thought", body: text });
    },
  },
});

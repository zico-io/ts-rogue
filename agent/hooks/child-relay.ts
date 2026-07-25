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

// Fresh per child session; captures the Linear agent session id and the
// delegated issue identifier from the text the parent hands the child (ctx
// exposes no Linear id of its own).
const relay = defineState<{
  agentSessionId: string | null;
  issueId: string | null;
}>("ts-rogue.child-relay", () => ({ agentSessionId: null, issueId: null }));

// The parent's delegation text carries the Linear session id in the framework
// context block (`agent_session_id: <id>`) or however the parent phrases it.
export const parseAgentSessionId = (text: string): string | null =>
  text.match(/agent_session_id["`\s:=]+([\w-]+)/)?.[1] ?? null;

// The delegation packet leads with `issue: <identifier> — <title>`. Ralph mode
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
  } catch {
    // Observe-only: a Linear hiccup must never fail the child's turn.
  }
};

const MAX_PARAMETER = 300;

export default defineHook({
  events: {
    async "message.received"(event, ctx) {
      if (!ctx.session.parent) return;
      capturePacketFacts(event.data.message);
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
        await post(
          {
            type: "action",
            action: toolLabel(action.toolName),
            parameter:
              parameter.length > MAX_PARAMETER
                ? `${parameter.slice(0, MAX_PARAMETER)}…`
                : parameter,
          },
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
  },
});

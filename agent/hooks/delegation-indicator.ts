import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineHook } from "eve/hooks";

// A delegated coding child can run for many minutes while the root turn sits
// parked on the call, and the child's live chips are posted by the relay hook
// running inside the child - so between the delegation and the child's first
// chip the Linear session looks idle. Post an ephemeral working indicator the
// moment a child session starts. Linear shows an ephemeral activity only
// until the agent's next activity replaces it (the child's own chips), so
// this is a single transient status slot, never thread noise.
//
// Lives in a hook, not the channel: the channel adapter's event vocabulary
// has no `subagent.called`, but the hook stream does, and the hook context
// carries the Linear continuation token this needs.

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

// linearContinuationToken() format; a token without it (e.g. a merge-woken
// GitHub session) has no Linear agent session to post to.
const LINEAR_CONTINUATION_PREFIX = "agent-session:";

export const WORKING_INDICATOR =
  "Implementation running in a delegated worker - live progress follows here.";

export default defineHook({
  events: {
    async "subagent.called"(_event, ctx) {
      const token = ctx.channel.continuationToken;
      if (!token?.startsWith(LINEAR_CONTINUATION_PREFIX)) return;
      try {
        await createLinearAgentActivity({
          credentials,
          activity: {
            agentSessionId: token.slice(LINEAR_CONTINUATION_PREFIX.length),
            content: { body: WORKING_INDICATOR, type: "thought" },
            ephemeral: true,
          },
        });
      } catch {
        // Observe-only: a Linear hiccup must never fail the turn.
      }
    },
  },
});

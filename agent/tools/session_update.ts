import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { relayIssueId } from "../hooks/child-relay";

// Under EVE_EVAL_MOCK_MODEL the delegation eval swaps in a fake bearer and
// points `api.apiBaseUrl` at its local mock GraphQL server (`LinearApiOptions`
// documents both as test overrides), so the coerced activity body is
// observable without a live Linear session. With the flag set but no base
// URL, the fake bearer 401s against real Linear - no write is possible.
const credentials = process.env.EVE_EVAL_MOCK_MODEL
  ? { accessToken: "eval-mock" }
  : connectLinearCredentials("linear/ts-rogue-eve");

const api = process.env.LINEAR_API_BASE_URL
  ? { apiBaseUrl: process.env.LINEAR_API_BASE_URL }
  : undefined;

// The three human-handoff moments. Routine progress lives in the durable
// `todo` plan (mirrored into Linear's Agent Plan by the channel's
// `syncAgentPlanFromTodoTool`), not in chat updates - the old
// `started`/`progress` statuses posted durable `response` activities
// mid-work, and Linear derives session state from the last activity, so a
// Progress update flipped the session to Finished while a delegated child
// was still running (HAR-38/HAR-40).
type SessionUpdateStatus = "blocked" | "review" | "completed";

export const sessionUpdateActivity = ({
  message,
  status,
}: {
  message: string;
  status: SessionUpdateStatus;
}) => ({
  body: `**${status[0]?.toUpperCase()}${status.slice(1)}**\n\n${message}`,
  // `response` is the only durable, top-level activity type; `thought`/`action`
  // nest under the turn's open tool-call block. Session updates are deliberate
  // messages to the user, so they belong at the top level of the Linear chat.
  type: "response" as const,
});

/**
 * Root updates pass through untouched. A child may post only `blocked`,
 * prefixed with its delegated issue (mirroring the child-relay chip prefix)
 * so parallel children stay attributable; `review` and `completed` from a
 * child are refused in code - they read as the whole session finishing
 * (ENG-2, HAR-11) - so no prompt drift can reintroduce them. The refusal is
 * a structured return, not a throw: a thrown result reads as a harness
 * failure, while a returned object is a policy answer the child model sees.
 */
export const forSessionRole = (
  input: { message: string; status: SessionUpdateStatus },
  isChild: boolean,
  issueId: string | null,
): { message: string; status: SessionUpdateStatus } | { refused: string } => {
  if (!isChild) return input;
  if (input.status !== "blocked") {
    return {
      refused: `A delegated child cannot post status "${input.status}" - review and completed belong to the session owner. Report your result in your final reply; "blocked" is the only status a child may post.`,
    };
  }
  return {
    message: issueId ? `[${issueId}] ${input.message}` : input.message,
    status: "blocked",
  };
};

export default defineTool({
  description:
    "Post a detailed Markdown update to the current Linear Agent Session at a human-handoff moment: blocked (what stops you and what you need), review (the finished deliverable and its evidence), completed (the closing summary). Routine progress belongs in the todo plan, not here.",
  inputSchema: z.object({
    agentSessionId: z.string().min(1),
    message: z.string().min(1).max(5000),
    status: z.enum(["blocked", "review", "completed"]),
  }),
  async execute(input, ctx) {
    const update = forSessionRole(
      input,
      ctx.session.parent != null,
      relayIssueId(),
    );
    if ("refused" in update) {
      return { delivered: false, refused: update.refused };
    }
    await createLinearAgentActivity({
      api,
      credentials,
      activity: {
        agentSessionId: input.agentSessionId,
        content: sessionUpdateActivity(update),
      },
    });
    return { delivered: true };
  },
});

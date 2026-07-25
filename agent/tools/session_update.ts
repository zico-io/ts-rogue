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

type SessionUpdateStatus =
  | "started"
  | "progress"
  | "blocked"
  | "review"
  | "completed";

// A delegated child's update must read as progress inside the parent's
// session, never as a session-level milestone: ENG-2's thread showed a child
// "Completed" while nothing was pushed, then "Started" again when the next
// child began - the session appeared to finish and restart twice. Coerced in
// code so no prompt drift can reintroduce it; only the session owner can mark
// started/review/completed.
const CHILD_STATUS: Record<SessionUpdateStatus, SessionUpdateStatus> = {
  started: "progress",
  progress: "progress",
  blocked: "blocked",
  review: "progress",
  completed: "progress",
};

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

/** Root updates pass through untouched; a child's are downgraded to progress/blocked and prefixed with its delegated issue (mirroring the child-relay chip prefix) so parallel children stay attributable. */
export const forSessionRole = (
  input: { message: string; status: SessionUpdateStatus },
  isChild: boolean,
  issueId: string | null,
): { message: string; status: SessionUpdateStatus } => {
  if (!isChild) return input;
  return {
    message: issueId ? `[${issueId}] ${input.message}` : input.message,
    status: CHILD_STATUS[input.status],
  };
};

export default defineTool({
  description:
    "Post a detailed Markdown update to the current Linear Agent Session. Call when work starts, after meaningful milestones, when blocked, at review, and before completion. Include what changed, evidence, blockers, and the next action when applicable.",
  inputSchema: z.object({
    agentSessionId: z.string().min(1),
    message: z.string().min(1).max(5000),
    status: z.enum(["started", "progress", "blocked", "review", "completed"]),
  }),
  async execute(input, ctx) {
    const update = forSessionRole(
      input,
      ctx.session.parent != null,
      relayIssueId(),
    );
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

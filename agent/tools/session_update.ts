import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { relayIssueId } from "../hooks/relay";

const credentials = process.env.EVE_EVAL_MOCK_MODEL
  ? { accessToken: "eval-mock" }
  : connectLinearCredentials("linear/ts-rogue-eve");

const api = process.env.LINEAR_API_BASE_URL
  ? { apiBaseUrl: process.env.LINEAR_API_BASE_URL }
  : undefined;

type SessionUpdateStatus = "blocked" | "review" | "completed";

export const sessionUpdateActivity = ({
  message,
  status,
}: {
  message: string;
  status: SessionUpdateStatus;
}) => ({
  body: `**${status[0]?.toUpperCase()}${status.slice(1)}**\n\n${message}`,

  type: "response" as const,
});

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

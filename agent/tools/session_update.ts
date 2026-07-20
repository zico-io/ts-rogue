import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineTool } from "eve/tools";
import { z } from "zod";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

export const sessionUpdateActivity = ({
  message,
  status,
}: {
  message: string;
  status: "started" | "progress" | "blocked" | "review" | "completed";
}) => ({
  body: `**${status[0]?.toUpperCase()}${status.slice(1)}**\n\n${message}`,
  type: "thought" as const,
});

export default defineTool({
  description:
    "Post a detailed Markdown update to the current Linear Agent Session. Call when work starts, after meaningful milestones, when blocked, at review, and before completion. Include what changed, evidence, blockers, and the next action when applicable.",
  inputSchema: z.object({
    agentSessionId: z.string().min(1),
    message: z.string().min(1).max(5000),
    status: z.enum(["started", "progress", "blocked", "review", "completed"]),
  }),
  async execute(input) {
    await createLinearAgentActivity({
      credentials,
      activity: {
        agentSessionId: input.agentSessionId,
        content: sessionUpdateActivity(input),
      },
    });
    return { delivered: true };
  },
});

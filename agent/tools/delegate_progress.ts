import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineTool } from "eve/tools";
import { z } from "zod";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

export const delegateProgressActivity = ({
  message,
  status,
}: {
  message: string;
  status: "started" | "progress" | "blocked" | "completed";
}) => ({
  body: `Delegate ${status}: ${message}`,
  type: "thought" as const,
});

export default defineTool({
  description:
    "Relay a delegated child's meaningful progress to its parent Linear Agent Session. Call when starting, reaching a milestone, becoming blocked, and before returning.",
  inputSchema: z.object({
    agentSessionId: z.string().min(1),
    message: z.string().min(1).max(500),
    status: z.enum(["started", "progress", "blocked", "completed"]),
  }),
  async execute(input, ctx) {
    if (!ctx.session.parent) throw new Error("Only delegated children can relay progress");
    await createLinearAgentActivity({
      credentials,
      activity: {
        agentSessionId: input.agentSessionId,
        content: delegateProgressActivity(input),
      },
    });
    return { delivered: true };
  },
});

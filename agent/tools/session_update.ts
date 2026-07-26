import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineTool } from "eve/tools";
import { z } from "zod";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");
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

export default defineTool({
  description:
    "Post a blocked, review-ready, or completion update to the current Linear Agent Session.",
  inputSchema: z.object({
    agentSessionId: z.string().min(1),
    message: z.string().min(1).max(5000),
    status: z.enum(["blocked", "review", "completed"]),
  }),
  async execute({ agentSessionId, message, status }) {
    await createLinearAgentActivity({
      api,
      credentials,
      activity: {
        agentSessionId,
        content: sessionUpdateActivity({ message, status }),
      },
    });
    return { delivered: true };
  },
});

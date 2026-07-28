import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { stripLeadingProseHeader } from "../lib/prose";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");
const api = process.env.LINEAR_API_BASE_URL
  ? { apiBaseUrl: process.env.LINEAR_API_BASE_URL }
  : undefined;

export default defineTool({
  description:
    "Post a concise blocked, review-ready, or completion update to the current Linear Agent Session. Start with the outcome; do not add a heading or repeat issue metadata.",
  inputSchema: z.object({
    agentSessionId: z.string().min(1),
    message: z.string().min(1).max(5000),
  }),
  async execute({ agentSessionId, message }) {
    await createLinearAgentActivity({
      api,
      credentials,
      activity: {
        agentSessionId,
        content: {
          body: stripLeadingProseHeader(message),
          type: "response",
        },
      },
    });
    return { delivered: true };
  },
});

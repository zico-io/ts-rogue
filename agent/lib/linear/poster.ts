import { connectLinearCredentials } from "@vercel/connect/eve";
import { createLinearAgentActivity } from "eve/channels/linear";

import type { SessionUpdate } from "../session";
import { activityText } from "./activity";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");
const api = process.env.LINEAR_API_BASE_URL
  ? { apiBaseUrl: process.env.LINEAR_API_BASE_URL }
  : undefined;

const CONTINUATION_PREFIX = "agent-session:";

type ActivityContent = Parameters<
  typeof createLinearAgentActivity
>[0]["activity"]["content"];

/** One update as an Agent Activity, or `null` when it has no activity form. */
const activityContent = (update: SessionUpdate): ActivityContent | null => {
  switch (update.kind) {
    case "thought":
    case "response":
    case "error":
      return { body: update.body, type: update.kind };
    case "action":
      return {
        action: update.action,
        parameter: activityText(update.parameter),
        type: "action",
        ...(update.result === undefined
          ? {}
          : { result: activityText(update.result) }),
      };
    default:
      return null;
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Posts into a Linear Agent Session addressed only by its continuation token. */
export const postLinearUpdate = async (
  continuationToken: string,
  update: SessionUpdate,
): Promise<void> => {
  if (!continuationToken.startsWith(CONTINUATION_PREFIX)) return;
  const content = activityContent(update);
  if (content === null) return;
  try {
    await createLinearAgentActivity({
      api,
      credentials,
      activity: {
        agentSessionId: continuationToken.slice(CONTINUATION_PREFIX.length),
        content,
        ephemeral: update.kind === "action" ? update.transient : undefined,
      },
    });
  } catch (error) {
    console.warn(
      "postLinearUpdate: posting a Linear activity failed:",
      errorMessage(error),
    );
  }
};

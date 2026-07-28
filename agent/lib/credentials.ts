import {
  connectGitHubCredentials,
  connectLinearCredentials,
} from "@vercel/connect/eve";
import type { LinearChannelConfig } from "eve/channels/linear";

/** The agent's brokered Linear identity, shared by every channel and tool. */
export const linearAgentCredentials = connectLinearCredentials(
  "linear/ts-rogue-eve",
);

export const githubAgentCredentials = connectGitHubCredentials(
  "github/ts-rogue-eve-github",
);

export async function resolveLinearAccessToken(
  accessToken: NonNullable<LinearChannelConfig["credentials"]>["accessToken"],
): Promise<string> {
  const resolved =
    typeof accessToken === "function"
      ? await accessToken()
      : (accessToken ??
        process.env.LINEAR_AGENT_ACCESS_TOKEN ??
        process.env.LINEAR_ACCESS_TOKEN ??
        process.env.LINEAR_API_KEY ??
        process.env.LINEAR_API_TOKEN);
  if (!resolved) {
    throw new Error(
      "linearChannel: missing Linear access token. Pass credentials.accessToken or set LINEAR_AGENT_ACCESS_TOKEN, LINEAR_ACCESS_TOKEN, LINEAR_API_KEY, or LINEAR_API_TOKEN.",
    );
  }
  return resolved;
}

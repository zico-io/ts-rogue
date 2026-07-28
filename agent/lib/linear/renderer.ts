import type {
  LinearAgentSessionUpdateInput,
  LinearChannelContext,
} from "eve/channels/linear";
import {
  linearInputRequestSignal,
  renderLinearInputRequests,
} from "eve/channels/linear";
import type { SessionContext } from "eve/tools";

import type { ChannelRenderer } from "../channel";
import { linearAgentCredentials } from "../credentials";
import type { SessionUpdate } from "../session";
import { activityText } from "./activity";
import { linearUserIdFromAuthContext } from "./authorization";
import { advanceIssueState } from "./issue-state";
import { pendingState } from "./session";

/** Linear's rendering: every update becomes an Agent Activity. */
export const linearRenderer: ChannelRenderer<LinearChannelContext> = {
  restartHint: "Start a new Linear agent session to continue.",

  /** Buffering must survive between events, so it rides the channel state. */
  scratch: pendingState,

  async render(
    update: SessionUpdate,
    channel: LinearChannelContext,
    ctx?: SessionContext,
  ): Promise<void> {
    switch (update.kind) {
      case "thought":
      case "response":
      case "error":
        await channel.linear.createActivity(
          { body: update.body, type: update.kind },
          update.kind === "thought" && update.transient
            ? { ephemeral: true }
            : {},
        );
        if (
          update.kind === "error" &&
          update.fatal === true &&
          channel.state.issueId != null
        ) {
          await advanceIssueState({
            credentials: linearAgentCredentials,
            issueRef: channel.state.issueId,
            target: "blocked",
          });
        }
        return;
      case "action":
        await channel.linear.createActivity(
          {
            action: update.action,
            parameter: activityText(update.parameter),
            type: "action",
            ...(update.result === undefined
              ? {}
              : { result: activityText(update.result) }),
          },
          update.transient ? { ephemeral: true } : {},
        );
        return;
      case "authPrompt": {
        const content = { body: update.body, type: "elicitation" } as const;
        if (update.url === undefined) {
          await channel.linear.createActivity(content);
          return;
        }
        const userId = linearUserIdFromAuthContext(
          ctx?.session.auth.current ?? null,
        );
        await channel.linear.createActivity(content, {
          signal: "auth",
          signalMetadata: {
            providerName: update.displayName,
            url: update.url,
            ...(userId !== undefined ? { userId } : {}),
          },
        });
        return;
      }
      case "inputPrompt":
        await channel.linear.createActivity(
          {
            body: renderLinearInputRequests(update.requests),
            type: "elicitation",
          },
          linearInputRequestSignal(update.requests),
        );
        return;
      case "plan":
        await channel.linear.updateSession({
          plan: update.steps as unknown as LinearAgentSessionUpdateInput["plan"],
        });
        return;
    }
  },
};

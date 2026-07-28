import { connectLinearCredentials } from "@vercel/connect/eve";
import {
  callLinearGraphQL,
  createLinearAgentSessionOnComment,
} from "eve/channels/linear";
import type { ToolContext } from "eve/tools";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { formatCheckpointComment } from "../lib/linear/checkpoint";
import { listLiveAgentSessions } from "../lib/linear/live-sessions";
import { stripLeadingProseHeader } from "../lib/prose";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

const callerAgentSessionId = (ctx: ToolContext): string | null => {
  const attribute = (ctx.session.auth.current ?? ctx.session.auth.initiator)
    ?.attributes.agent_session_id;
  return typeof attribute === "string" && attribute.length > 0
    ? attribute
    : null;
};

export const createLinearComment = async (input: {
  readonly issueId: string;
  readonly body: string;
}): Promise<string> => {
  const data = await callLinearGraphQL<{
    commentCreate?: { success?: boolean; comment?: { id?: string } };
  }>({
    credentials,
    query: `
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }
    `,
    queryName: "CommentCreate",
    variables: {
      input: { issueId: input.issueId, body: input.body },
    },
  });
  const commentId = data.commentCreate?.comment?.id;
  if (data.commentCreate?.success !== true || typeof commentId !== "string") {
    throw new Error(
      "handoff: Linear CommentCreate did not report success with a comment id.",
    );
  }
  return commentId;
};

export default defineTool({
  description:
    "Continue a Linear issue in a fresh, empty context window, seeded by a concise brief: start with substance rather than a heading, and state what is done, what remains, and the next action. Pass THIS issue's id at a phase boundary - right after opening the pull request, say - to continue the same Agent Session with the accumulated implementation context retired; the next inbound event runs fresh, and the call returns `checkpointed`. Pass a DIFFERENT ready sub-issue's id, whose blockers just merged, to start its own Agent Session with what the predecessor shipped; that returns `handoffSessionId`, or `alreadyLive` rather than duplicating a live session. End your turn immediately after calling this.",
  inputSchema: z.object({
    issueId: z.string().min(1),
    brief: z.string().min(1).max(8000),
  }),
  async execute(input, ctx) {
    const self = callerAgentSessionId(ctx);
    let live: Awaited<ReturnType<typeof listLiveAgentSessions>> = [];
    try {
      live = await listLiveAgentSessions({
        credentials,
        issueId: input.issueId,
      });
    } catch {}

    // Self-continuation: checkpoint in place rather than opening a second session.
    if (self !== null && live.some((session) => session.id === self)) {
      const checkpointCommentId = await createLinearComment({
        issueId: input.issueId,
        body: formatCheckpointComment(
          ctx.session.id,
          stripLeadingProseHeader(input.brief),
        ),
      });
      return { checkpointed: true, checkpointCommentId };
    }

    // Cross-issue handoff: one live session per issue (HAR-26).
    const existing = live.find((session) => session.id !== self);
    if (existing !== undefined) {
      return {
        alreadyLive: true,
        existingSessionId: existing.id,
        existingSessionUrl: existing.url,
      };
    }
    const commentId = await createLinearComment({
      issueId: input.issueId,
      body: stripLeadingProseHeader(input.brief),
    });
    const session = await createLinearAgentSessionOnComment({
      credentials,
      commentId,
    });
    return {
      handoffSessionId: session.id,
      handoffSessionUrl: session.url ?? null,
    };
  },
});

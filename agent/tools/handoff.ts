import { connectLinearCredentials } from "@vercel/connect/eve";
import {
  callLinearGraphQL,
  createLinearAgentSessionOnComment,
} from "eve/channels/linear";
import { defineTool } from "eve/tools";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { listLiveAgentSessions } from "../lib/live-sessions";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

const callerAgentSessionId = (ctx: ToolContext): string | null => {
  const attribute = (ctx.session.auth.current ?? ctx.session.auth.initiator)
    ?.attributes.agent_session_id;
  return typeof attribute === "string" && attribute.length > 0
    ? attribute
    : null;
};

const HANDOFF_COMMENT_HEADER = "**Agent handoff**\n\n---\n\n";

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
    "Start an informed Agent Session for a Linear issue. Use for a ready sub-issue or to continue long-running work with fresh context. The brief must state what is done, what remains, and the next action. Existing live sessions are returned instead of duplicated.",
  inputSchema: z.object({
    issueId: z.string().min(1),
    brief: z.string().min(1).max(8000),
  }),
  async execute(input, ctx) {
    try {
      const self = callerAgentSessionId(ctx);
      const existing = (
        await listLiveAgentSessions({ credentials, issueId: input.issueId })
      ).find((session) => session.id !== self);
      if (existing !== undefined) {
        return {
          alreadyLive: true,
          existingSessionId: existing.id,
          existingSessionUrl: existing.url,
        };
      }
    } catch {}
    const commentId = await createLinearComment({
      issueId: input.issueId,
      body: `${HANDOFF_COMMENT_HEADER}${input.brief}`,
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

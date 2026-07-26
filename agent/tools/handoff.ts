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
    "Hand off a Linear issue to a brand-new Agent Session with an empty context window and its own fresh token quota, seeded by a comment carrying `brief`. Two uses: (1) Self-continuation - the current session has run long enough to risk hitting its own token-quota limit. Pass the current issue's id and a full continuation packet (what's done with evidence, what's left, the exact next action), then end your own turn immediately after calling it. (2) Ralph-mode dependency unlock - a sub-issue just became ready because its blocker(s) merged. Pass that sub-issue's id and a brief carrying context its own issue packet won't have: what the predecessor(s) shipped (their PR), and any decisions or gotchas that affect this sub-issue's approach. Use this instead of a bare delegate assignment so the new session starts informed, not blind. Either way, `brief` must let a fresh agent with zero conversation history proceed without re-reading anything. If the issue already has another live Agent Session, this tool creates nothing and returns `alreadyLive` with that session's id and URL - treat the issue as in flight and report the existing session; never retry the handoff.",
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

import { connectLinearCredentials } from "@vercel/connect/eve";
import {
  callLinearGraphQL,
  createLinearAgentSessionOnComment,
} from "eve/channels/linear";
import type { ToolContext } from "eve/tools";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { formatCheckpointComment } from "../lib/checkpoint";
import { listLiveAgentSessions } from "../lib/live-sessions";
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
    "Continue a Linear issue in a fresh, empty context window, seeded by a concise `brief` (start with substance, not a heading; say what is done, what remains, and the exact next action). Self-continuation - pass the CURRENT issue's id at a phase boundary (e.g. right after opening the PR, so the review/merge webhook runs fresh): posts a context-checkpoint comment so the next inbound event resumes this SAME Linear session with fresh context, and returns `checkpointed`. You no longer need this to dodge a token limit - eve auto-compacts - so use it for the clean phase break. Ready sub-issue (ralph dependency unlock) - pass a DIFFERENT sub-issue's id whose blocker(s) just merged, with a brief carrying what the predecessor shipped: starts a new Agent Session on it and returns `handoffSessionId`. An already-live session on that sub-issue is returned as `alreadyLive` instead of duplicated. End your own turn immediately after calling this.",
  inputSchema: z.object({
    issueId: z.string().min(1),
    brief: z.string().min(1).max(8000),
  }),
  async execute(input, ctx) {
    const self = callerAgentSessionId(ctx);
    // A flaky lookup must never block a legitimate handoff: fail open to the
    // cross-issue path (create a fresh session) rather than throwing. An empty
    // list reads as "no live session", which is exactly the fail-open behavior.
    let live: Awaited<ReturnType<typeof listLiveAgentSessions>> = [];
    try {
      live = await listLiveAgentSessions({ credentials, issueId: input.issueId });
    } catch {
      live = [];
    }

    // Self-continuation: the caller's own Agent Session is live on the target
    // issue. Post a context checkpoint (agent/lib/checkpoint.ts) instead of
    // opening a SECOND Linear session - the linear channel reads the checkpoint
    // marker on the next inbound event and rotates the eve session (a fresh,
    // empty context window) behind this same Linear session. This is the common
    // case: pausing at a phase boundary (e.g. after opening the PR) so the
    // review/merge webhook runs fresh instead of resuming the accumulated
    // implementation context.
    if (self && live.some((s) => s.id === self)) {
      const checkpointCommentId = await createLinearComment({
        issueId: input.issueId,
        body: formatCheckpointComment(input.brief),
      });
      return { checkpointed: true, checkpointCommentId };
    }

    // Cross-issue handoff (ralph dependency unlock): one live session per issue.
    // Creating a second Agent Session while one is live is the HAR-26 duplicate.
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

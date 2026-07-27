import { connectLinearCredentials } from "@vercel/connect/eve";
import {
  callLinearGraphQL,
  createLinearAgentSessionOnComment,
} from "eve/channels/linear";
import { defineTool } from "eve/tools";
import type { ToolContext } from "eve/tools";
import { z } from "zod";

import { formatCheckpointComment } from "../lib/checkpoint";
import { listLiveAgentSessions } from "../lib/live-sessions";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

// The caller's own Linear Agent Session id, read from the dispatch auth
// attributes `defaultLinearAuth` stamps on every Linear-initiated session
// (the same channel-to-callback side channel HAR-24's review-only flag rides
// in `channels/github.ts`). Needed so the self-continuation use of this tool
// - where the caller's session is live on the very issue being handed off -
// does not count itself as a duplicate.
const callerAgentSessionId = (ctx: ToolContext): string | null => {
  const attribute = (ctx.session.auth.current ?? ctx.session.auth.initiator)
    ?.attributes.agent_session_id;
  return typeof attribute === "string" && attribute.length > 0
    ? attribute
    : null;
};

// Linear's Agent Session creation mutations have no free-text field of their
// own (`AgentSessionCreateOnIssue`/`AgentSessionCreateOnComment` only take
// id/link inputs - confirmed by reading the mutation shapes in
// `node_modules/eve/dist/src/public/channels/linear/api.js`); a session's
// initial message comes from whatever comment it's anchored to. A comment is
// therefore the only way to deliver a custom brief into a fresh session, not
// a side channel this tool invented - every human-initiated Agent Session
// already starts the same way, from a comment. This header just makes the
// comment read as deliberate handoff plumbing rather than a stray note. Kept
// generic (not framed as self-continuation-only) because this tool also seeds
// a ready sub-issue's fresh session in ralph mode (HAR-15) - the specific
// framing (why this session is starting, what came before) belongs in the
// model-authored `brief`, not this fixed header.
const HANDOFF_COMMENT_HEADER = "**Agent handoff**\n\n---\n\n";

/**
 * Posts a Linear comment and returns its id.
 *
 * Hand-rolled against `callLinearGraphQL` rather than a barrel export:
 * `commentCreate` is not exported from `eve/channels/linear`'s public barrel
 * (confirmed by reading `node_modules/eve/dist/src/public/channels/linear/api.d.ts`
 * and `.js` - only `createLinearAgentActivity`, `createLinearAgentSessionOnComment`,
 * `createLinearAgentSessionOnIssue`, `listLinearAgentSessionActivities`,
 * `updateLinearAgentSession`, and the generic `callLinearGraphQL` transport are
 * exported). This mirrors the exact call shape eve's own built-in mutations use:
 * `query` is a GraphQL string, `queryName` is used only for error reporting, and
 * `variables` wraps the payload in `{ input: {...} }`.
 */
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
    "Hand off to a fresh, empty context window seeded by a `brief`. Two uses: (1) Self-continuation - end the current phase and let the next inbound event resume this SAME Linear issue in a fresh eve session. Pass the current issue's id. Best at a natural pause where an event will wake it (right after opening the PR, so the review/merge webhook runs fresh) - not to keep working right now (eve auto-compacts, so you no longer need to hand off just to avoid a token limit). This posts a context-checkpoint comment (no second Linear session is created) and returns `checkpointed`; end your own turn immediately after calling it. (2) Ralph-mode dependency unlock - a DIFFERENT sub-issue just became ready because its blocker(s) merged. Pass that sub-issue's id and a brief carrying context its own issue packet won't have: what the predecessor(s) shipped (their PR), and any decisions or gotchas that affect its approach. This creates a brand-new Agent Session on that sub-issue and returns `handoffSessionId`. Either way, `brief` must let a fresh agent with zero conversation history proceed without re-reading anything: what the issue asked for, what's done with evidence, what's left, the exact next action. For case (2), if that issue already has another live Agent Session, this tool creates nothing and returns `alreadyLive` with its id and URL - treat it as in flight and never retry.",
  inputSchema: z.object({
    issueId: z.string().min(1),
    brief: z.string().min(1).max(8000),
  }),
  async execute(input, ctx) {
    const self = callerAgentSessionId(ctx);
    // A flaky lookup must never block a legitimate handoff: fail open to the
    // cross-issue path (create a fresh session) rather than throwing.
    let live: Awaited<ReturnType<typeof listLiveAgentSessions>> | null = null;
    try {
      live = await listLiveAgentSessions({ credentials, issueId: input.issueId });
    } catch {
      live = null;
    }

    // Self-continuation: the caller's own Agent Session is live on the target
    // issue. Post a context checkpoint (agent/lib/checkpoint.ts) instead of
    // opening a SECOND Linear session - the linear channel reads the checkpoint
    // marker on the next inbound event and rotates the eve session (a fresh,
    // empty context window) behind this same Linear session. This is the common
    // case: pausing at a phase boundary (e.g. after opening the PR) so the
    // review/merge webhook runs fresh instead of resuming the accumulated
    // implementation context.
    if (self && live?.some((s) => s.id === self)) {
      const checkpointCommentId = await createLinearComment({
        issueId: input.issueId,
        body: formatCheckpointComment(input.brief),
      });
      return { checkpointed: true, checkpointCommentId };
    }

    // Cross-issue handoff (ralph dependency unlock): one live session per issue.
    // Creating a second Agent Session while one is live is the HAR-26 duplicate.
    if (live !== null) {
      const existing = live.find((session) => session.id !== self);
      if (existing !== undefined) {
        return {
          alreadyLive: true,
          existingSessionId: existing.id,
          existingSessionUrl: existing.url,
        };
      }
    }
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

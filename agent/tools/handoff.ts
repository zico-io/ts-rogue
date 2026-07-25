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
    "Hand off a Linear issue to a brand-new Agent Session with an empty context window and its own fresh token quota, seeded by a comment carrying `brief`. Two uses: (1) Self-continuation - the current session has run long enough to risk hitting its own token-quota limit. Pass the current issue's id and a full continuation packet (what's done with evidence, what's left, the exact next action), then end your own turn immediately after calling it. (2) Ralph-mode dependency unlock - a sub-issue just became ready because its blocker(s) merged. Pass that sub-issue's id and a brief carrying context its own issue packet won't have: what the predecessor(s) shipped (their PR), and any decisions or gotchas that affect this sub-issue's approach. Use this instead of a bare delegate assignment so the new session starts informed, not blind. Either way, `brief` must let a fresh agent with zero conversation history proceed without re-reading anything. If the issue already has another live Agent Session, this tool creates nothing and returns `alreadyLive` with that session's id and URL - treat the issue as in flight and report the existing session; never retry the handoff.",
  inputSchema: z.object({
    issueId: z.string().min(1),
    brief: z.string().min(1).max(8000),
  }),
  async execute(input, ctx) {
    // One live session per issue: creating a second Agent Session while one
    // is live is exactly the HAR-26 duplicate. The caller's own session
    // (self-continuation) is exempt; a pre-check failure fails open because
    // a flaky lookup must never block a legitimate handoff.
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
    } catch {
      // fail open
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

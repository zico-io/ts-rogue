import { connectLinearCredentials } from "@vercel/connect/eve";
import {
  callLinearGraphQL,
  createLinearAgentSessionOnComment,
} from "eve/channels/linear";
import { defineTool } from "eve/tools";
import { z } from "zod";

const credentials = connectLinearCredentials("linear/ts-rogue-eve");

// Linear's Agent Session creation mutations have no free-text field of their
// own (`AgentSessionCreateOnIssue`/`AgentSessionCreateOnComment` only take
// id/link inputs - confirmed by reading the mutation shapes in
// `node_modules/eve/dist/src/public/channels/linear/api.js`); a session's
// initial message comes from whatever comment it's anchored to. A comment is
// therefore the only way to deliver a custom brief into a fresh session, not
// a side channel this tool invented - every human-initiated Agent Session
// already starts the same way, from a comment. This header just makes the
// comment read as deliberate handoff plumbing rather than a stray note.
const HANDOFF_COMMENT_HEADER =
  "**Agent handoff**\n\nSeeding a fresh Agent Session so this issue keeps moving with an empty context window and a fresh token quota, instead of running into a token-quota limit in this session.\n\n---\n\n";

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
    "Hand off the current issue to a brand-new Linear Agent Session with an empty context window and a fresh token quota. Call this when the current session has been running long enough to risk hitting its own token-quota limit - a long ralph-mode group session or a deep delegation chain - instead of waiting for eve's own continue/stop prompt. `brief` must be a full continuation packet, written so a fresh agent with zero conversation history can resume without re-reading anything: what the issue asked for, what is already done (with evidence - commits, PR state, test results), what is left, and the exact next action. After calling this tool, end your own turn immediately; do not keep working in this session.",
  inputSchema: z.object({
    issueId: z.string().min(1),
    brief: z.string().min(1).max(8000),
  }),
  async execute(input) {
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

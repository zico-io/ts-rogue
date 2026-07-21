// Helpers for the ralph (issue-group) end-to-end eval. Not an eval file itself.

// The dedicated Linear fixture the eval drives. Set these to a real test group
// so the eval runs; leave any unset and the eval skips (keeps `eve eval` green
// without the fixture). Recommended fixture under one parent assigned to Eve:
//
//   PARENT   parent issue, assigned to the Eve agent, with three sub-issues:
//     DONE     state Done            (an already-merged predecessor)
//     READY    "blocked by" DONE     (now ready, since DONE is complete)
//     BLOCKED  "blocked by" READY    (still blocked)
//
// The one correct move on the parent is to drive READY: it honors the satisfied
// blocker (a merged predecessor unblocks the next - the "advance after merge"
// rule), skips the finished DONE, and does not jump ahead to BLOCKED.
export interface RalphFixture {
  parent: string;
  ready: string;
  blocked: string;
}

export const ralphFixture = (): RalphFixture | null => {
  const parent = process.env.RALPH_EVAL_PARENT;
  const ready = process.env.RALPH_EVAL_READY;
  const blocked = process.env.RALPH_EVAL_BLOCKED;
  return parent && ready && blocked ? { parent, ready, blocked } : null;
};

// A synthetic Linear Agent Session delegation, mirroring the `<linear_context>`
// block eve's Linear channel injects (see channels/linear inbound). The
// agent_session_id is intentionally blank: with no live Linear session to post
// to, the agent skips session_update and the eval reads its git/delegation
// decisions instead. issue_identifier carries the parent so the agent reads the
// group over the real Linear MCP.
export const linearDelegation = (parentIdentifier: string): string =>
  [
    "<linear_context>",
    "action: created",
    "agent_session_id: ",
    "agent_session_url: ",
    "organization_id: ",
    "issue_id: ",
    `issue_identifier: ${parentIdentifier}`,
    "issue_title: ",
    "issue_url: ",
    "comment_id: ",
    "source_comment_id: ",
    "response_medium: linear_agent_activity",
    "</linear_context>",
    "",
    `You have been assigned ${parentIdentifier}. Drive it.`,
  ].join("\n");

// Whether an event/action represents the agent committing to *drive* the given
// issue - creating its branch off main, delegating its implementation, or moving
// it into progress - as opposed to merely reading it during planning. The eval
// asserts it drives the ready issue and never drives the blocked one.
export const drivesIssue = (node: unknown, id: string): boolean => {
  const s = JSON.stringify(node ?? "");
  if (!new RegExp(`\\b${id}\\b`, "i").test(s)) return false;
  return (
    /(checkout\s+-b|switch\s+-c|git\s+branch|git\s+switch)/i.test(s) ||
    /"kind"\s*:\s*"(delegate|subagent)"|"toolName"\s*:\s*"agent"/i.test(s) ||
    /save_issue|update[_-]?issue/i.test(s)
  );
};

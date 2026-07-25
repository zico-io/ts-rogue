// Helpers for the ralph (issue-group) end-to-end eval. Not an eval file itself.

// The dedicated Linear fixture the eval drives. These are stable, public issue
// identifiers (not secrets) for a do-not-delete group in team ROG, so they live
// in code rather than a CI secret. Structure under the parent:
//
//   PARENT (ROG-57), with three sub-issues:
//     DONE     (ROG-58)  state Done            an already-merged predecessor
//     READY    (ROG-59)  "blocked by" DONE     now ready, since DONE is complete
//     BLOCKED  (ROG-60)  "blocked by" READY    still blocked
//
// The one correct move on the parent is to drive READY: it honors the satisfied
// blocker (a merged predecessor unblocks the next - the "advance after merge"
// rule), skips the finished DONE, and does not jump ahead to BLOCKED. DONE is
// implied by READY becoming ready, so it is not asserted on.
export interface RalphFixture {
  parent: string;
  ready: string;
  blocked: string;
}

export const RALPH_FIXTURE: RalphFixture = {
  parent: "ROG-57",
  ready: "ROG-59",
  blocked: "ROG-60",
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
    /(checkout\s+-b|switch\s+-c|git\s+branch|git\s+switch|worktree\s+add)/i.test(
      s,
    ) ||
    /"kind"\s*:\s*"(delegate|subagent)"|"toolName"\s*:\s*"agent"/i.test(s) ||
    /save_issue|update[_-]?issue/i.test(s)
  );
};

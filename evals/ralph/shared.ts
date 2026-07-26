














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





export const drivesIssue = (node: unknown, id: string): boolean => {
  const s = JSON.stringify(node ?? "");
  if (!new RegExp(`\\b${id}\\b`, "i").test(s)) return false;
  return (
    /(checkout\s+-b|switch\s+-c|git\s+branch|git\s+switch|worktree\s+add)/i.test(
      s,
    ) ||
    /"kind"\s*:\s*"(delegate|subagent)"|"toolName"\s*:\s*"agent"/i.test(s) ||
    /handoff|save_issue|update[_-]?issue/i.test(s)
  );
};

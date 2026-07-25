import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { never } from "eve/tools/approval";

export default defineMcpClientConnection({
  url: "https://mcp.linear.app/mcp",
  description:
    "Linear workspace for ts-rogue issues, projects, priorities, assignments, and status.",
  // App-scoped, non-interactive: the agent acts as itself against Linear's
  // MCP server, resolving the same Linear agent-app token the channel and
  // authored tools already use unattended (`linear/ts-rogue-eve`), exactly
  // the shape eve's auth guide prescribes for "act as the agent itself".
  // This replaced user-scoped `connect("mcp.linear.app/ts-rogue-eve-mcp")`
  // (HAR-33): interactive OAuth binds the grant to the inbound principal,
  // and ralph's merge-wake turns arrive on the GitHub channel under a
  // GitHub sender who has never authorized - eve parked every merge-advance
  // turn on a consent flow no one could see, so issue groups never advanced.
  // Unattended turns (merge wakes, schedules) cannot do interactive OAuth at
  // all; acting as the app removes the consent flow everywhere.
  auth: connect({ connector: "linear/ts-rogue-eve", principalType: "app" }),
  // Smallest surface the contract needs: `save_issue` is the one write the
  // prompts require (breakdown sub-issues, delegate assignment, schedule-filed
  // issues); the rest is read-only lookup. Every other write (save_comment,
  // save_project, save_document, delete_*, merge_diff, submit_diff_review,
  // attachments, labels, releases, status updates) stays out - session posts
  // go through the authored `session_update`/`handoff` tools instead. An
  // unknown name in `allow` is inert; if a flow needs a missing read tool,
  // connection_search will surface the gap - widen then.
  tools: {
    allow: [
      "save_issue",
      "get_issue",
      "list_issues",
      "list_comments",
      "get_team",
      "list_teams",
      "get_user",
      "list_users",
      "list_issue_statuses",
      "list_issue_labels",
      "get_project",
      "list_projects",
      "list_cycles",
      "list_milestones",
      "get_document",
      "list_documents",
      "search_documentation",
    ],
  },
  // `save_issue` runs in unattended ralph turns and is already human-gated
  // upstream by the ask_question breakdown approval.
  approval: never(),
});

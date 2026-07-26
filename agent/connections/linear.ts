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
  // Smallest surface the contract needs: `save_issue` is the one issue write
  // the prompts require (breakdown sub-issues, delegate assignment,
  // schedule-filed issues, applying an existing type label at orientation -
  // `save_issue` takes a labels field, so no extra tool is needed).
  // `save_project` (HAR-47) is the matching project write: without it eve
  // could read projects (`list_projects`/`get_project`) but had no way to
  // act on a request like "promote this issue to a project, and its
  // sub-issues to normal issues" - the Linear MCP server has always
  // published `save_project`, it just sat outside this allow-list.
  // instructions.md's "Promoting an issue to a project" section covers the
  // create-project/reparent-sub-issues/link-back sequencing.
  //
  // The `linear-project-manager` and `linear-project-update` skills (HAR-64)
  // extend that same project-content write surface: `save_milestone`,
  // `save_document`, and `create_issue_label` are the writes the
  // project-manager scaffolding procedure needs (milestones as dependency
  // groups, Decision Log / Meeting Notes documents, project labels), and
  // `save_status_update` (+ the read `get_status_updates`) is what
  // project-update posts. These are all project-content objects the same way
  // `save_project` is - not Agent-Session activity - so they belong in the
  // allow-list, following the HAR-47 precedent. In particular a project
  // *status update* is Linear's project health feed; it does not flip any
  // Agent-Session lifecycle state, so it is unlike `save_comment` (a session
  // post), which stays out and is routed through the authored
  // `session_update`/`handoff` tools instead.
  //
  // The rest stays read-only lookup: every remaining write (save_comment,
  // delete_*, merge_diff, submit_diff_review, attachments, releases) stays
  // out. An unknown name in `allow` is inert; if a flow needs a missing read
  // tool, connection_search will surface the gap - widen then.
  tools: {
    allow: [
      "save_issue",
      "save_project",
      "save_milestone",
      "save_document",
      "save_status_update",
      "create_issue_label",
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
      "get_status_updates",
      "get_document",
      "list_documents",
      "search_documentation",
    ],
  },
  // `save_issue` runs in unattended ralph turns and is already human-gated
  // upstream by the ask_question breakdown approval. `save_project` never
  // runs in ralph flow at all - it is only reachable from an explicit human
  // request in the conversation (instructions.md's "Promoting an issue to a
  // project") - so it needs no separate gate either. The HAR-64
  // project-workflow writes (save_milestone/save_document/save_status_update/
  // create_issue_label) are the same shape: reachable only from an explicit
  // human request via the two Linear skills, each of which parks on
  // `ask_question` for approval before it writes - so no separate gate here.
  approval: never(),
});

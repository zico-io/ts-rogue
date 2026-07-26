import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { never } from "eve/tools/approval";

export default defineMcpClientConnection({
  url: "https://mcp.linear.app/mcp",
  description:
    "Linear workspace for ts-rogue issues, projects, priorities, assignments, and status.",

  auth: connect({ connector: "linear/ts-rogue-eve", principalType: "app" }),

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

  approval: never(),
});

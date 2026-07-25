import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { never } from "eve/tools/approval";

// Replaces the hand-rolled `vercel_logs` tool (get_runtime_logs bounds the
// stream server-side) and adds runtime errors, build logs, and deployment
// listings the hand-rolled layer never had. Traces, observability queries,
// and sandbox reads are NOT on this server - they come from the `vercel-api`
// OpenAPI connection next to this file.
export default defineMcpClientConnection({
  url: "https://mcp.vercel.com",
  description:
    "Vercel deployments, build and runtime logs, runtime errors, and web analytics for this project.",
  auth: connect("mcp.vercel.com/ts-rogue-vercel-mcp"),
  // Read-only surface; deploy_to_vercel, purchases, and toolbar tools stay out.
  tools: {
    allow: [
      "get_runtime_logs",
      "get_runtime_errors",
      "get_deployment_build_logs",
      "list_deployments",
      "get_deployment",
      "get_project",
      "list_projects",
      "get_web_analytics",
      "search_vercel_documentation",
    ],
  },
  approval: never(),
});

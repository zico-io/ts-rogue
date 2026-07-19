import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

export const approveLinearTool = ({
  approvedTools,
  toolName,
}: {
  approvedTools: ReadonlySet<string>;
  toolName: string;
}) => {
  const operation = toolName.split("__").at(-1) ?? toolName;
  if (/^(get|list|search)_/.test(operation)) return "not-applicable";
  return approvedTools.has(toolName) ? "not-applicable" : "user-approval";
};

export default defineMcpClientConnection({
  url: "https://mcp.linear.app/mcp",
  description: "Linear workspace for ts-rogue issues, projects, priorities, assignments, and status.",
  auth: connect("mcp.linear.app/ts-rogue-eve-mcp"),
  approval: approveLinearTool,
});

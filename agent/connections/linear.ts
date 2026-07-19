import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";
import { once } from "eve/tools/approval";

export default defineMcpClientConnection({
  url: "https://mcp.linear.app/mcp",
  description: "Linear workspace for ts-rogue issues, projects, priorities, assignments, and status.",
  auth: connect("mcp.linear.app/ts-rogue-eve-mcp"),
  approval: once(),
});

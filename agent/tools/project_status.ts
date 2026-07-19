import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Read the current ts-rogue branch and working-tree status before planning repository work.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const sandbox = await ctx.getSandbox();
    const result = await sandbox.run({ command: "git status --short --branch" });
    if (result.exitCode !== 0) throw new Error(result.stderr || "git status failed");
    return {
      repository: "zico-io/ts-rogue",
      projectPlan: "PROJECT_PLAN.md",
      status: result.stdout.trim(),
    };
  },
});

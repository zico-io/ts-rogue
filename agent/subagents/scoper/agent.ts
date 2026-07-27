import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Scopes a multi-deliverable request into an approvable breakdown: outcome, non-goals, milestones with exit conditions, and tickets with objectives, acceptance criteria, and native dependencies. Plans only; never writes to Linear, GitHub, or the repository.",
  model: "anthropic/claude-opus-4.8",
  modelContextWindowTokens: 1_040_000,
});

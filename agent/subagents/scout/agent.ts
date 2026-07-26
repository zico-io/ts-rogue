import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Fast codebase recon: locates relevant files, call paths, existing utilities, and gotchas, and returns compressed context for a delegation packet.",
  model: "deepseek/deepseek-v4-flash",
  // Disable reasoning: deepseek-v4-flash's default interleaved reasoning parts
  // desync the AI Gateway stream assembler and crash-loop the durable step
  // (same failure documented on the coder subagent and in agent/README.md).
  reasoning: "none",
});

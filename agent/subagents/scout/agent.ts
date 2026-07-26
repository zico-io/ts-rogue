import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Fast codebase recon: locates relevant files, call paths, existing utilities, and gotchas, and returns compressed context for a delegation packet.",
  // Haiku replaced deepseek-v4-flash for the same reason as the coder: the
  // deepseek reasoning stream desyncs the AI Gateway assembler even with
  // `reasoning: "none"`, and the durable-step replays turned a ~2.5-minute
  // scout into a 21-minute one (ENG-19, 2026-07-26; see agent/README.md).
  model: "anthropic/claude-haiku-4.5",
});

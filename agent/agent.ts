import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  // Compaction *trigger* (eve compacts at floor(value * 0.9)), not a hard cap.
  // Bounds per-turn transcript re-read; see "Session cost and context window"
  // in agent/README.md for the rationale and tuning guidance.
  modelContextWindowTokens: 400_000,
});

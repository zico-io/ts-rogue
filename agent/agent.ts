import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  // Compaction trigger, not a hard cap; see agent/README.md for the rationale.
  modelContextWindowTokens: 400_000,
});

import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  modelContextWindowTokens: 1_040_000,
});

import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Independently plays a pushed ts-rogue branch in the terminal or web UI and returns acceptance verdicts with visual evidence. It never changes code.",
  model: "anthropic/claude-sonnet-5",
  modelContextWindowTokens: 1_040_000,
});

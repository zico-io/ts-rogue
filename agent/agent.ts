import { defineAgent, defineDynamic } from "eve";

// The coding child follows a tight orientation packet, so a fast, cheap model
// is fine here.
export const codingWorkerModel = (event: unknown) =>
  (event as { data?: { invocation?: unknown } }).data?.invocation
    ? { model: "deepseek/deepseek-v4-flash", modelContextWindowTokens: 1_000_000 }
    : null;

export default defineAgent({
  // The orchestrator plans, decides, and drives git/PR work; a weak model here
  // ruminates and second-guesses instead of acting. Use a strong, decisive
  // reasoning model. Upgrade to anthropic/claude-opus-4.8 if planning quality
  // still falls short.
  model: defineDynamic({
    fallback: "anthropic/claude-sonnet-5",
    events: { "session.started": codingWorkerModel },
  }),
  modelContextWindowTokens: 1_040_000,
});

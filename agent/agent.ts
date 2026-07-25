import { defineAgent, defineDynamic } from "eve";
import { mockModel } from "eve/evals";

import { delegationResponder } from "./lib/mock-delegation";

// The built-in `agent` tool now only handles quick same-sandbox mechanical
// work (substantive implementation goes to the declared `coder` subagent, see
// agent/subagents/coder/), but that child still follows a tight orientation
// packet, so a fast, cheap model is fine here.
export const codingWorkerModel = (event: unknown) =>
  (event as { data?: { invocation?: unknown } }).data?.invocation
    ? { model: "deepseek/deepseek-v4-flash", modelContextWindowTokens: 1_000_000 }
    : null;

export default defineAgent({
  // The orchestrator plans, decides, and drives git/PR work; a weak model here
  // ruminates and second-guesses instead of acting. Use a strong, decisive
  // reasoning model. Upgrade to anthropic/claude-opus-4.8 if planning quality
  // still falls short.
  //
  // EVE_EVAL_MOCK_MODEL swaps in the scripted delegation fixture (eve's docs
  // prescribe a dedicated fixture agent; this repo has one agent, so an env
  // gate is the minimal equivalent). Production and plain `eve eval` never
  // set it.
  model: process.env.EVE_EVAL_MOCK_MODEL
    ? mockModel(delegationResponder)
    : defineDynamic({
        fallback: "anthropic/claude-sonnet-5",
        events: { "session.started": codingWorkerModel },
      }),
  modelContextWindowTokens: 1_040_000,
});

import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

import { delegationResponder } from "./lib/mock-delegation";

export default defineAgent({
  // The orchestrator plans, decides, and drives git/PR work; a weak model here
  // ruminates and second-guesses instead of acting. Use a strong, decisive
  // reasoning model. Upgrade to anthropic/claude-opus-4.8 if planning quality
  // falls short.
  //
  // There is no separate cheap "coding worker" model any more: substantive
  // implementation is delegated to the declared `coder` subagent
  // (agent/subagents/coder/, its own sandbox, anthropic/claude-haiku-4-5),
  // and the built-in `agent` tool's quick same-sandbox mechanical work just
  // runs this same orchestrator model. This replaces the old dynamic
  // `codingWorkerModel`, which swapped deepseek onto the built-in coding child
  // before the `coder` subagent existed.
  //
  // EVE_EVAL_MOCK_MODEL swaps in the scripted delegation fixture (eve's docs
  // prescribe a dedicated fixture agent; this repo has one agent, so an env
  // gate is the minimal equivalent). Production and plain `eve eval` never
  // set it.
  model: process.env.EVE_EVAL_MOCK_MODEL
    ? mockModel(delegationResponder)
    : "anthropic/claude-sonnet-5",
  modelContextWindowTokens: 1_040_000,
});

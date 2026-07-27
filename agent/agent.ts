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
  // (agent/subagents/coder/, its own sandbox, anthropic/claude-haiku-4.5),
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
  // Compaction trigger, NOT a hard cap. eve derives its auto-compaction
  // threshold as floor(modelContextWindowTokens * 0.9) (eve
  // execution/session.js `createCompactionConfig`); crossing it summarizes the
  // older transcript region and keeps the recent tail verbatim - graceful, no
  // pause. (Session *parking* is a separate knob, `maxInputTokensPerSession`,
  // default 40M - untouched here.) Production cost analysis (2026-07-27) found
  // long-lived Linear sessions re-reading a near-1M-token transcript on every
  // one of a turn's ~14 tool round-trips (~14M input tokens/turn). Compacting
  // at ~360K instead of ~936K bounds that re-read to a fraction while leaving
  // sonnet-5 ample working context. Tune down further (watching implementation
  // quality) or up (if summaries drop needed detail).
  modelContextWindowTokens: 400_000,
});

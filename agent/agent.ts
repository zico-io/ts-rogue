import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
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

import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

import { delegationResponder } from "./lib/mock-delegation";

export default defineAgent({
  model: process.env.EVE_EVAL_MOCK_MODEL
    ? mockModel(delegationResponder)
    : "anthropic/claude-sonnet-5",
  modelContextWindowTokens: 1_040_000,
});

import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Implements one scoped issue packet on a named branch: reads only task-relevant files and their callers, writes the change, verifies with `pnpm check`, commits, and pushes the branch. No sizing, no ralph mode, no Linear session ownership.",
  // The packet is a tight, pre-scoped orientation, so a fast, cheap model is
  // fine - the same model the built-in `agent` tool's coding-child branch
  // used before this subagent existed (see `agent/agent.ts`'s
  // `codingWorkerModel`).
  model: "deepseek/deepseek-v4-flash",
});

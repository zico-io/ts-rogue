import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Implements one scoped issue packet on a named branch: reads only task-relevant files and their callers, writes the change, verifies with `pnpm check`, commits, and pushes the branch. No sizing, no ralph mode, no Linear session ownership.",
  // The packet is a tight, pre-scoped orientation, so a fast, cheap model is
  // fine. This is now the single coding path (the old `codingWorkerModel`
  // deepseek swap on the built-in `agent`-tool child has been removed - see
  // `agent/agent.ts`).
  model: "deepseek/deepseek-v4-flash",
  // deepseek-v4-flash is a hybrid model that emits reasoning by default, and
  // through the AI Gateway those interleaved reasoning parts desync the
  // ai@7 stream assembler (`text part <id> not found`), which fails the model
  // call and makes the durable workflow step retry from scratch - a coder
  // implementing one issue looped for ~an hour that way (see the incident in
  // agent/README.md). Disable reasoning via AI SDK's normalized setting; the
  // gateway exposes no deepseek-specific reasoning providerOption.
  reasoning: "none",
});

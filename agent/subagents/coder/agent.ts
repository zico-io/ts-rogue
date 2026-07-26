import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Implements one scoped issue packet on a named branch: reads only task-relevant files and their callers, writes the change, verifies with `pnpm check`, commits, and pushes the branch. No sizing, no ralph mode, no Linear session ownership.",
  // The packet is a tight, pre-scoped orientation, so a fast, cheap model is
  // fine. This is the single coding path (the old `codingWorkerModel` swap on
  // the built-in `agent`-tool child has been removed - see `agent/agent.ts`).
  //
  // Haiku replaced deepseek-v4-flash: deepseek's reasoning parts desync the
  // AI Gateway's ai@7 stream assembler (`text part <id> not found`) even with
  // `reasoning: "none"`, and each "recoverable" failure replays this
  // subagent's whole durable turn from scratch - measured at 15-70 minutes
  // per coder run on 2026-07-26 (see agent/README.md's workaround audit).
  model: "anthropic/claude-haiku-4-5",
});

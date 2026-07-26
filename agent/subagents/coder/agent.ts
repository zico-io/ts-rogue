import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Implements one scoped issue packet on a named branch: reads only task-relevant files and their callers, writes the change, verifies with `pnpm check`, commits, and pushes the branch. No sizing, no ralph mode, no Linear session ownership.",

  model: "anthropic/claude-haiku-4.5",
});

import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Fast codebase recon: locates relevant files, call paths, existing utilities, and gotchas, and returns compressed context for a delegation packet.",

  model: "anthropic/claude-haiku-4.5",
});

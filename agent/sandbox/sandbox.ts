import { defineSandbox } from "eve/sandbox";

import { mintFreshPolicy } from "../lib/sandbox/github-token";
import { buildSandboxDefinition } from "../lib/sandbox/recipe";

// `hooks/prewarm-sandbox.ts` mints through this module so the hook and the
// recipe agree on one sandbox definition.
export { mintFreshPolicy };

export default defineSandbox(
  buildSandboxDefinition({
    push: true,
    screenshotTooling: true,
    seedGitHubConfig: false,
  }),
);

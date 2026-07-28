import { defineSandbox } from "eve/sandbox";

import { buildSandboxDefinition } from "../lib/sandbox/recipe";

export default defineSandbox(
  buildSandboxDefinition({
    push: true,
    screenshotTooling: true,
    seedGitHubConfig: false,
  }),
);

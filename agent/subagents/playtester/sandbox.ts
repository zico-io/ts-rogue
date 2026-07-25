import { defineSandbox } from "eve/sandbox";

import { buildSandboxDefinition } from "../../lib/sandbox";

// Read-only git: playtester fetches and checks out a branch to verify, but
// never pushes (it never fixes anything, only reports). screenshotTooling
// installs and verifies the Playwright chromium scripts/play-web.mjs needs.
export default defineSandbox(
  buildSandboxDefinition({ gitAuthLevel: "read-only", screenshotTooling: true }),
);

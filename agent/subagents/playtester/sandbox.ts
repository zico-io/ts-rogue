import { defineSandbox } from "eve/sandbox";

import { buildSandboxDefinition } from "../../lib/sandbox";

export default defineSandbox(
  buildSandboxDefinition({
    gitAuthLevel: "read-only",
    screenshotTooling: true,
  }),
);

import { defineSandbox } from "eve/sandbox";

import { buildSandboxDefinition } from "../../lib/sandbox";

// Repo checkout + toolchain (see agent/lib/sandbox.ts), no screenshot
// tooling (coder never renders or verifies UI - that's playtester's job),
// and full push-capable GitHub auth: unlike reviewer/scout, coder commits and
// pushes its own feature branch rather than handing local commits back to a
// shared sandbox.
export default defineSandbox(
  buildSandboxDefinition({ gitAuthLevel: "push-capable" }),
);

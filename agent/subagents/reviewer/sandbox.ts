import { defineSandbox } from "eve/sandbox";

import { buildSandboxDefinition } from "../../lib/sandbox";

// Repo checkout + toolchain (see agent/lib/sandbox.ts), no screenshot
// tooling (a PR review never renders the UI), and just enough GitHub auth to
// fetch a diff and POST a review via curl - never push.
export default defineSandbox(
  buildSandboxDefinition({ gitAuthLevel: "read-only" }),
);

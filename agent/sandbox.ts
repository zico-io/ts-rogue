import { defineSandbox } from "eve/sandbox";

import { createSandboxRecipe } from "./lib/sandbox";

// The root's sandbox is the historical, unparameterized shape the shared
// recipe in lib/sandbox.ts (HAR-26) was extracted from: full push-capable
// git/gh auth (the root pushes its own feature branches and its coding
// child's), and screenshot tooling on (the root's coding child may ship a
// rendered-UI change and needs `scripts/play-web.mjs` to evidence it). A
// declared subagent under `agent/subagents/<id>/sandbox.ts` composes the same
// `createSandboxRecipe` with its own narrower options instead of duplicating
// any of this - see that module's doc comment for the options it supports.
export default defineSandbox(
  createSandboxRecipe({ gitAuth: "push-capable", screenshotTooling: true }),
);

// Re-exported for the existing test suite (src/sandbox-token-refresh.test.ts,
// src/prewarm-sandbox.test.ts) and hooks/prewarm-sandbox.ts, which reach for
// these pieces directly rather than through the composed recipe above.
export {
  AUTO_RECOVER_PUSH_COMMAND,
  buildBootstrapCommand,
  dependencyRevalidationKey,
  keepTokenFresh,
  MAX_SET_POLICY_FAILURES,
  mintFreshPolicy,
  resolveStartupNetworkPolicy,
  SYNC_MAIN_COMMAND,
  type TokenRefreshTiming,
  withTimeout,
} from "./lib/sandbox";

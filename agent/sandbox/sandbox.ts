import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import {
  buildOrientationBrief,
  GIT_FACTS_COMMAND,
  parseGitFacts,
  parseScreenshotToolingStatus,
  SCREENSHOT_STATUS_PATH,
} from "../lib/orientation";
import {
  AUTO_RECOVER_PUSH_COMMAND,
  buildBootstrapCommand,
  dependencyRevalidationKey,
  keepTokenFresh,
  MAX_MINT_FAILURES,
  MAX_SET_POLICY_FAILURES,
  mintFreshPolicy,
  resolveBootstrapNetworkPolicy,
  resolveStartupNetworkPolicy,
  SANDBOX_TIMEOUT_MS,
  TOKEN_MINT_TIMEOUT_MS,
  TOKEN_REFRESH_MS,
  TOKEN_RETRY_MS,
  type TokenRefreshTiming,
  WORKSPACE_GIT_CONFIG_ENV,
  withTimeout,
} from "../lib/sandbox";

// Re-exported so downstream imports (src/sandbox-token-refresh.test.ts,
// src/prewarm-sandbox.test.ts, agent/hooks/prewarm-sandbox.ts) that reach for
// this shared sandbox-provisioning infrastructure via "../agent/sandbox/sandbox"
// (the root's own module) keep working unchanged now that its definitions live
// in ../lib/sandbox for a future subagent's sandbox.ts to compose too.
export {
  AUTO_RECOVER_PUSH_COMMAND,
  buildBootstrapCommand,
  dependencyRevalidationKey,
  keepTokenFresh,
  MAX_MINT_FAILURES,
  MAX_SET_POLICY_FAILURES,
  mintFreshPolicy,
  resolveBootstrapNetworkPolicy,
  resolveStartupNetworkPolicy,
  SANDBOX_TIMEOUT_MS,
  TOKEN_MINT_TIMEOUT_MS,
  TOKEN_REFRESH_MS,
  TOKEN_RETRY_MS,
  type TokenRefreshTiming,
  WORKSPACE_GIT_CONFIG_ENV,
  withTimeout,
};

/** Reads back the bootstrap-written screenshot-tooling status; always exits 0 (missing file reads as unavailable via `parseScreenshotToolingStatus`). */
const READ_SCREENSHOT_STATUS_COMMAND = `cat ${SCREENSHOT_STATUS_PATH} 2>/dev/null || true`;

export default defineSandbox({
  backend: vercel({
    timeout: SANDBOX_TIMEOUT_MS,
    env: WORKSPACE_GIT_CONFIG_ENV,
  }),
  revalidationKey: dependencyRevalidationKey,
  async bootstrap({ use }) {
    // Fail loudly if GitHub auth can't be minted: bootstrap must clone a
    // private repo, so coming up on the unauthenticated fallback would abort
    // the clone mid-chain and leave an empty /workspace (see
    // resolveBootstrapNetworkPolicy).
    const policy = await resolveBootstrapNetworkPolicy();
    const sandbox = await use({ networkPolicy: policy });
    const setup = await sandbox.run({
      // This folder-layout sandbox mirrors `workspace/**` (this directory's
      // `hosts.yml`/`.gitconfig` seed files, HAR-36) into `/workspace` before
      // this command ever runs, so `seedGitHubConfig: false` skips
      // buildBootstrapCommand's own shell-heredoc equivalent of that seeding.
      command: buildBootstrapCommand({
        screenshotTooling: true,
        seedGitHubConfig: false,
      }),
    });
    if (setup.exitCode !== 0)
      throw new Error(setup.stderr || "Sandbox pre-warming failed");
  },
  async onSession({ use }) {
    const { policy, authed } = await resolveStartupNetworkPolicy();
    // `timeout` re-ups the lifetime ceiling on every attach: the backend's
    // create-time value (above) never reaches resumed sandboxes, and `use`
    // options land in the SDK's `Sandbox.update`, which accepts it.
    const sandbox = await use({
      networkPolicy: policy,
      timeout: SANDBOX_TIMEOUT_MS,
    });
    // Flush any commits stranded by a prior push failure now that auth is
    // confirmed, before the agent even starts (see AUTO_RECOVER_PUSH_COMMAND).
    // Best-effort and skipped entirely when unauthenticated, since it would
    // just fail the same way the agent's own push already would.
    if (authed) {
      try {
        await sandbox.run({ command: AUTO_RECOVER_PUSH_COMMAND });
      } catch {
        // Leave the commits in place; ORIENTATION.md's unpushed-commit line
        // (computed from GIT_FACTS_COMMAND below) still surfaces them.
      }
    }
    // Pre-compute the orientation brief so the model reads settled repo state
    // instead of rediscovering it. Best-effort: a missing brief only means the
    // model falls back to orienting by hand, so it must never fail the session.
    try {
      const facts = await sandbox.run({ command: GIT_FACTS_COMMAND });
      // Screenshot tooling is a property of the baked image (written once at
      // bootstrap), not of this session, so this just reads back that verdict
      // rather than re-running the chromium-launch check per session.
      const screenshotStatus = await sandbox.run({
        command: READ_SCREENSHOT_STATUS_COMMAND,
      });
      if (facts.exitCode === 0)
        await sandbox.writeTextFile({
          path: "ORIENTATION.md",
          content: buildOrientationBrief(
            parseGitFacts(facts.stdout),
            parseScreenshotToolingStatus(screenshotStatus.stdout),
            authed,
          ),
        });
    } catch {
      // Leave orientation to the model rather than failing startup over a brief.
    }
    // If startup couldn't mint the token, retry soon so push recovers fast;
    // otherwise refresh on the normal cadence.
    keepTokenFresh(sandbox, mintFreshPolicy, {
      initialMs: authed ? TOKEN_REFRESH_MS : TOKEN_RETRY_MS,
    });
  },
});

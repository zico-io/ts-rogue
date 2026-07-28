import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import {
  AUTO_RECOVER_PUSH_COMMAND,
  buildBootstrapCommand,
  buildOrientationBrief,
  dependencyRevalidationKey,
  GIT_FACTS_COMMAND,
  initialTokenRefreshDelayMs,
  keepTokenFresh,
  mintFreshPolicy,
  mintFreshPolicyWithExpiry,
  parseGitFacts,
  parseScreenshotToolingStatus,
  resolveBootstrapNetworkPolicy,
  resolveStartupAuth,
  SANDBOX_TIMEOUT_MS,
  SCREENSHOT_STATUS_PATH,
  WORKSPACE_GIT_CONFIG_ENV,
} from "../lib/sandbox";

// `hooks/prewarm-sandbox.ts` mints through this module so the hook and the
// recipe agree on one sandbox definition.
export { mintFreshPolicy };

const READ_SCREENSHOT_STATUS_COMMAND = `cat ${SCREENSHOT_STATUS_PATH} 2>/dev/null || true`;

export default defineSandbox({
  backend: vercel({
    timeout: SANDBOX_TIMEOUT_MS,
    env: WORKSPACE_GIT_CONFIG_ENV,
  }),
  revalidationKey: dependencyRevalidationKey,
  async bootstrap({ use }) {
    const policy = await resolveBootstrapNetworkPolicy();
    const sandbox = await use({ networkPolicy: policy });
    const setup = await sandbox.run({
      command: buildBootstrapCommand({
        screenshotTooling: true,
        seedGitHubConfig: false,
      }),
    });
    if (setup.exitCode !== 0)
      throw new Error(setup.stderr || "Sandbox pre-warming failed");
  },
  async onSession({ use }) {
    // resolveStartupAuth (not resolveStartupNetworkPolicy) so keepTokenFresh
    // gets this session's real token expiry - see StartupAuthResult.
    const auth = await resolveStartupAuth();

    const sandbox = await use({
      networkPolicy: auth.policy,
      timeout: SANDBOX_TIMEOUT_MS,
    });

    if (auth.authed) {
      try {
        await sandbox.run({ command: AUTO_RECOVER_PUSH_COMMAND });
      } catch {}
    }

    try {
      const facts = await sandbox.run({ command: GIT_FACTS_COMMAND });

      const screenshotStatus = await sandbox.run({
        command: READ_SCREENSHOT_STATUS_COMMAND,
      });
      if (facts.exitCode === 0)
        await sandbox.writeTextFile({
          path: "ORIENTATION.md",
          content: buildOrientationBrief(
            parseGitFacts(facts.stdout),
            parseScreenshotToolingStatus(screenshotStatus.stdout),
            auth.authed,
          ),
        });
    } catch {}

    keepTokenFresh(sandbox, mintFreshPolicyWithExpiry, {
      initialMs: initialTokenRefreshDelayMs(auth),
    });
  },
});

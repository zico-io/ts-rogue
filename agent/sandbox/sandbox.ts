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
    const { policy, authed } = await resolveStartupNetworkPolicy();

    const sandbox = await use({
      networkPolicy: policy,
      timeout: SANDBOX_TIMEOUT_MS,
    });

    if (authed) {
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
            authed,
          ),
        });
    } catch {}

    keepTokenFresh(sandbox, mintFreshPolicy, {
      initialMs: authed ? TOKEN_REFRESH_MS : TOKEN_RETRY_MS,
    });
  },
});

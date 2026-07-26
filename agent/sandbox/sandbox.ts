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
  initialTokenRefreshDelayMs,
  keepTokenFresh,
  MAX_MINT_FAILURES,
  MAX_SET_POLICY_FAILURES,
  MIN_TOKEN_REFRESH_MS,
  type MintedGitHubPolicy,
  mintFreshPolicy,
  mintFreshPolicyWithExpiry,
  nextRefreshDelayMs,
  resolveBootstrapNetworkPolicy,
  resolveStartupAuth,
  resolveStartupNetworkPolicy,
  SANDBOX_TIMEOUT_MS,
  TOKEN_EXPIRY_BUFFER_MS,
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
  initialTokenRefreshDelayMs,
  keepTokenFresh,
  MAX_MINT_FAILURES,
  MAX_SET_POLICY_FAILURES,
  MIN_TOKEN_REFRESH_MS,
  type MintedGitHubPolicy,
  mintFreshPolicy,
  mintFreshPolicyWithExpiry,
  nextRefreshDelayMs,
  resolveBootstrapNetworkPolicy,
  resolveStartupAuth,
  resolveStartupNetworkPolicy,
  SANDBOX_TIMEOUT_MS,
  TOKEN_EXPIRY_BUFFER_MS,
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
    // Use the expiry-aware mint here (not resolveStartupNetworkPolicy) so
    // the token minted for *this* session's own network policy can also
    // seed keepTokenFresh's first refresh off its real expiry, instead of
    // that first refresh falling back to a blind TOKEN_REFRESH_MS guess
    // (HAR-69/HAR-72).
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

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { getTokenResponse } from "@vercel/connect";
import type {
  SandboxDefinition,
  SandboxNetworkPolicy,
  SandboxSession,
} from "eve/sandbox";
import {
  type VercelSandboxBootstrapUseOptions,
  type VercelSandboxSessionUseOptions,
  vercel,
} from "eve/sandbox/vercel";

import { SCREENSHOT_STATUS_PATH } from "./orientation";

// Ceiling on how long `keepTokenFresh` waits between successful refreshes.
// The real cadence now tracks the token's actual expiry (see
// TOKEN_EXPIRY_BUFFER_MS below); this only bounds how stale a refresh is
// allowed to get if a token were ever minted with an unexpectedly long life.
export const TOKEN_REFRESH_MS = 45 * 60 * 1000;

// Never schedule a refresh sooner than this, even if a token's remaining
// life is short, so a misbehaving or short-lived token can't make
// keepTokenFresh hammer the broker in a tight loop.
export const MIN_TOKEN_REFRESH_MS = 5 * 60 * 1000;

// How much runway to leave on the clock before a token's real expiry when
// scheduling the next refresh. GitHub App installation tokens live ~1h
// (HAR-69, ed6e164); this buffer needs to comfortably outlast the bounded
// retry chain below (MAX_MINT_FAILURES * TOKEN_RETRY_MS, ~10 minutes) so a
// transient broker outage can be retried to completion before the
// currently-active credential actually goes invalid.
export const TOKEN_EXPIRY_BUFFER_MS = 20 * 60 * 1000;

export const TOKEN_RETRY_MS = 30 * 1000;

export const TOKEN_MINT_TIMEOUT_MS = 10 * 1000;

export const MAX_SET_POLICY_FAILURES = 20;

export const MAX_MINT_FAILURES = 20;

export const SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000;

export const OPEN_NETWORK_POLICY: SandboxNetworkPolicy = { allow: { "*": [] } };

export interface MintedGitHubPolicy {
  policy: SandboxNetworkPolicy;

  /** The minted token's real expiry, from Vercel Connect, in epoch ms. */
  expiresAtMs: number;
}

/**
 * Mints a GitHub network policy and reports the token's real expiry, so
 * callers can schedule the next refresh off actual token life instead of a
 * guessed cadence (HAR-69).
 */
export async function mintGitHubTokenPolicy(): Promise<MintedGitHubPolicy> {
  const response = await getTokenResponse(
    "github/ts-rogue-eve-github",
    { subject: { type: "app" }, scopes: ["*"] },

    // Bypass @vercel/connect's in-process token cache: it serves a cached
    // token until 30 seconds before its ~1h expiry, which turned a fixed
    // refresh cadence into a no-op re-install of the same dying token
    // (ed6e164). Every caller is a deliberate refresh point that wants a
    // genuinely fresh token, and mints happen at most a few times an hour,
    // so skipping the cache costs one Connect roundtrip and nothing else.
    { forceRefresh: true },
  );
  const authorization = `Basic ${Buffer.from(`x-access-token:${response.token}`).toString("base64")}`;
  return {
    policy: {
      allow: {
        "github.com": [{ transform: [{ headers: { authorization } }] }],
        "*.github.com": [{ transform: [{ headers: { authorization } }] }],
        "*": [],
      },
    },
    expiresAtMs: response.expiresAt,
  };
}

export async function githubNetworkPolicy(): Promise<SandboxNetworkPolicy> {
  return (await mintGitHubTokenPolicy()).policy;
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  void work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("token mint timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const STARTUP_MINT_ATTEMPTS = 4;
export const STARTUP_MINT_RETRY_GAP_MS = 3 * 1000;

async function mintWithRetries<T>(
  mintPolicy: () => Promise<T>,
  attempts: number,
  perAttemptTimeoutMs: number,
  gapMs: number,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(mintPolicy(), perAttemptTimeoutMs);
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, gapMs));
    }
  }
}

/**
 * `onSession`'s session-start auth outcome. `expiresAtMs` is the load-bearing
 * addition over the older `{ policy, authed }` shape: see its own doc for
 * why (HAR-69/HAR-72). Everywhere else in this file just points back here.
 */
export interface StartupAuthResult {
  policy: SandboxNetworkPolicy;

  authed: boolean;

  /**
   * The minted token's real expiry, in epoch ms; unset when unauthed.
   *
   * `onSession` needs this to schedule `keepTokenFresh`'s very first
   * refresh off the token's actual remaining life instead of a blind
   * `TOKEN_REFRESH_MS` guess - the gap that let a short-lived session-start
   * token go unrefreshed past its own expiry (HAR-69/HAR-72). See
   * `initialTokenRefreshDelayMs`, which every `onSession` calls with this
   * field.
   */
  expiresAtMs?: number;
}

/**
 * Resolves authenticated GitHub access, falling back to an open policy so an
 * existing workspace can still start. Also surfaces the minted token's real
 * expiry (see `StartupAuthResult`).
 */
export async function resolveStartupAuth(
  mintPolicy: () => Promise<MintedGitHubPolicy> = mintGitHubTokenPolicy,
  timeoutMs: number = TOKEN_MINT_TIMEOUT_MS,
  attempts: number = STARTUP_MINT_ATTEMPTS,
  gapMs: number = STARTUP_MINT_RETRY_GAP_MS,
): Promise<StartupAuthResult> {
  try {
    const minted = await mintWithRetries(
      mintPolicy,
      attempts,
      timeoutMs,
      gapMs,
    );
    return {
      policy: minted.policy,
      authed: true,
      expiresAtMs: minted.expiresAtMs,
    };
  } catch (err) {
    console.warn(
      "resolveStartupAuth: GitHub token mint failed after retries; coming up on the unauthenticated OPEN network policy (git push/gh will fail until auth heals):",
      err instanceof Error ? err.message : err,
    );
    return { policy: OPEN_NETWORK_POLICY, authed: false };
  }
}

/**
 * Resolves authenticated GitHub access, falling back to an open policy so an
 * existing workspace can still start. Used by bootstrap, which only needs
 * the policy and never tracks expiry, so this mints the plain policy
 * directly rather than going through `resolveStartupAuth`'s
 * `MintedGitHubPolicy` shape.
 */
export async function resolveStartupNetworkPolicy(
  mintPolicy: () => Promise<SandboxNetworkPolicy> = githubNetworkPolicy,
  timeoutMs: number = TOKEN_MINT_TIMEOUT_MS,
  attempts: number = STARTUP_MINT_ATTEMPTS,
  gapMs: number = STARTUP_MINT_RETRY_GAP_MS,
): Promise<{ policy: SandboxNetworkPolicy; authed: boolean }> {
  try {
    return {
      policy: await mintWithRetries(mintPolicy, attempts, timeoutMs, gapMs),
      authed: true,
    };
  } catch (err) {
    console.warn(
      "resolveStartupNetworkPolicy: GitHub token mint failed after retries; coming up on the unauthenticated OPEN network policy (git push/gh will fail until auth heals):",
      err instanceof Error ? err.message : err,
    );
    return { policy: OPEN_NETWORK_POLICY, authed: false };
  }
}

/** Requires authenticated GitHub access because bootstrap clones a private repository. */
export async function resolveBootstrapNetworkPolicy(
  resolve: () => Promise<{
    policy: SandboxNetworkPolicy;
    authed: boolean;
  }> = resolveStartupNetworkPolicy,
): Promise<SandboxNetworkPolicy> {
  const { policy, authed } = await resolve();
  if (!authed) {
    throw new Error(
      "Sandbox bootstrap aborted: GitHub auth could not be minted, so the " +
        "private-repo checkout would fail and leave an empty /workspace. Retry " +
        "once GitHub auth is healthy - a fresh invocation re-mints the token.",
    );
  }
  return policy;
}

export interface TokenRefreshTiming {
  refreshMs?: number;

  retryMs?: number;

  initialMs?: number;
}

/** Clamps the next scheduled refresh so it tracks a token's real expiry. */
export function nextRefreshDelayMs(
  expiresAtMs: number,
  ceilingMs: number,
  now: number = Date.now(),
): number {
  const untilExpiry = expiresAtMs - now;
  return Math.min(
    ceilingMs,
    Math.max(MIN_TOKEN_REFRESH_MS, untilExpiry - TOKEN_EXPIRY_BUFFER_MS),
  );
}

/**
 * Computes `keepTokenFresh`'s first delay from a session-start
 * `StartupAuthResult` (see its doc for why this matters). Both `onSession`
 * implementations call this shared, directly-testable function instead of
 * inlining the ternary.
 */
export function initialTokenRefreshDelayMs(
  auth: Pick<StartupAuthResult, "authed" | "expiresAtMs">,
  ceilingMs: number = TOKEN_REFRESH_MS,
  retryMs: number = TOKEN_RETRY_MS,
): number {
  return auth.authed && auth.expiresAtMs !== undefined
    ? nextRefreshDelayMs(auth.expiresAtMs, ceilingMs)
    : retryMs;
}

/**
 * Refreshes sandbox authentication on unreferenced timers with bounded retry
 * chains, so refresh work cannot keep a serverless invocation alive.
 *
 * Successful refreshes are re-scheduled off the minted token's real expiry
 * (HAR-69) rather than a fixed guessed cadence, so the retry chain below
 * always has the same generous, measured runway before the active
 * credential could actually go invalid.
 */
export function keepTokenFresh(
  sandbox: Pick<SandboxSession, "setNetworkPolicy">,
  mintPolicy: () => Promise<MintedGitHubPolicy> = mintFreshPolicyWithExpiry,
  timing: number | TokenRefreshTiming = TOKEN_REFRESH_MS,
) {
  const refreshMs =
    typeof timing === "number"
      ? timing
      : (timing.refreshMs ?? TOKEN_REFRESH_MS);
  const retryMs =
    typeof timing === "number" ? timing : (timing.retryMs ?? TOKEN_RETRY_MS);
  const initialMs =
    typeof timing === "number" ? timing : (timing.initialMs ?? refreshMs);

  let setPolicyFailures = 0;
  let mintFailures = 0;
  const schedule = (delayMs: number): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(async () => {
      let minted: MintedGitHubPolicy;
      try {
        minted = await mintPolicy();
      } catch (err) {
        const message = err instanceof Error ? err.message : err;
        if (++mintFailures >= MAX_MINT_FAILURES) {
          console.warn(
            `keepTokenFresh: token mint failed ${mintFailures} times in a row, giving up until the next turn-start re-mint:`,
            message,
          );
          return;
        }
        console.warn(
          `keepTokenFresh: token mint failed (${mintFailures}/${MAX_MINT_FAILURES}), retrying in ${retryMs}ms:`,
          message,
        );
        schedule(retryMs);
        return;
      }
      mintFailures = 0;
      try {
        await sandbox.setNetworkPolicy(minted.policy);
      } catch (err) {
        console.warn(
          `keepTokenFresh: setNetworkPolicy failed (${setPolicyFailures + 1}/${MAX_SET_POLICY_FAILURES}):`,
          err instanceof Error ? err.message : err,
        );
        if (++setPolicyFailures >= MAX_SET_POLICY_FAILURES) return;
        schedule(retryMs);
        return;
      }
      setPolicyFailures = 0;
      schedule(nextRefreshDelayMs(minted.expiresAtMs, refreshMs));
    }, delayMs);

    timer.unref?.();
    return timer;
  };

  return schedule(initialMs);
}

export const mintFreshPolicy = () =>
  withTimeout(githubNetworkPolicy(), TOKEN_MINT_TIMEOUT_MS);

export const mintFreshPolicyWithExpiry = () =>
  withTimeout(mintGitHubTokenPolicy(), TOKEN_MINT_TIMEOUT_MS);

/** Keys dependency snapshots by lockfile content, with the commit as a read-failure fallback. */
export function dependencyRevalidationKey(): string {
  try {
    const lock = readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url));
    return `deps:${createHash("sha256").update(lock).digest("hex")}`;
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  }
}

const USE_HTTPS_APT_MIRRORS_COMMAND =
  "sudo sed -i 's#http://archive.ubuntu.com#https://archive.ubuntu.com#; s#http://security.ubuntu.com#https://security.ubuntu.com#' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true";

export const WORKSPACE_GH_CONFIG_DIR_PATH = "/workspace/.config/gh";

export const WORKSPACE_GIT_CONFIG_GLOBAL_PATH = "/workspace/.gitconfig";

export const WORKSPACE_GIT_CONFIG_ENV: Record<string, string> = {
  GH_CONFIG_DIR: WORKSPACE_GH_CONFIG_DIR_PATH,
  GIT_CONFIG_GLOBAL: WORKSPACE_GIT_CONFIG_GLOBAL_PATH,
};

const SEED_GH_CLI_AUTH_COMMAND = [
  `mkdir -p "${WORKSPACE_GH_CONFIG_DIR_PATH}"`,
  `printf 'github.com:\\n    oauth_token: placeholder-overwritten-by-network-broker\\n    git_protocol: https\\n' > "${WORKSPACE_GH_CONFIG_DIR_PATH}/hosts.yml"`,
].join(" && ");

export function buildBootstrapCommand(options?: {
  screenshotTooling?: boolean;
  seedGitHubConfig?: boolean;
}): string {
  const screenshotTooling = options?.screenshotTooling ?? true;
  const seedGitHubConfig = options?.seedGitHubConfig ?? true;
  const verifyChromiumLaunches = `node -e "require('playwright').chromium.launch().then(b=>b.close())"`;
  const installScreenshotTooling = [
    "mkdir -p /workspace/.eve",

    `(corepack pnpm exec playwright install --with-deps chromium && ${verifyChromiumLaunches} && echo '{"available":true}' > ${SCREENSHOT_STATUS_PATH}) || echo '{"available":false,"reason":"playwright chromium failed to install or launch during sandbox bootstrap"}' > ${SCREENSHOT_STATUS_PATH}`,
  ].join(" && ");

  return [
    USE_HTTPS_APT_MIRRORS_COMMAND,
    "(sudo apt-get update && sudo apt-get install -y tmux ripgrep fd-find bat eza gh) || true",

    "(sudo ln -sf /usr/bin/fdfind /usr/local/bin/fd || true)",
    "(sudo ln -sf /usr/bin/batcat /usr/local/bin/bat || true)",
    ...(seedGitHubConfig ? [SEED_GH_CLI_AUTH_COMMAND] : []),
    "(npm install -g @earendil-works/pi-coding-agent@0.81.1 || true)",

    "(pi install git:github.com/DietrichGebert/ponytail || true)",
    "(npm install -g @ast-grep/cli || true)",

    ...(seedGitHubConfig
      ? ["git config --global --add safe.directory '*'"]
      : []),

    "git init -q -b main .",
    "git remote add origin https://github.com/zico-io/ts-rogue.git",
    "git fetch --depth 1 origin main",
    "git reset --hard origin/main",
    "corepack pnpm install --frozen-lockfile",
    ...(screenshotTooling ? [installScreenshotTooling] : []),
  ].join(" && ");
}

export const AUTO_RECOVER_PUSH_COMMAND = [
  "export GIT_TERMINAL_PROMPT=0",
  'CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"',
  'if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "HEAD" ]; then ' +
    "if git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then " +
    'AHEAD="$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)"; ' +
    'if [ "$AHEAD" != "0" ]; then ' +
    'echo "onSession: auto-recovering $AHEAD unpushed commit(s) on $CURRENT_BRANCH"; ' +
    'git push origin "$CURRENT_BRANCH" || echo "onSession: auto-recover push failed, leaving commits for the agent to retry"; ' +
    "fi; " +
    "else " +
    'echo "onSession: auto-recovering new branch $CURRENT_BRANCH (no upstream yet)"; ' +
    'git push -u origin "$CURRENT_BRANCH" || echo "onSession: auto-recover push failed, leaving commits for the agent to retry"; ' +
    "fi; " +
    "fi",
].join(" ; ");

export type GitAuthLevel = "none" | "read-only" | "push-capable";

export interface SandboxRecipeOptions {
  gitAuthLevel: GitAuthLevel;

  screenshotTooling?: boolean;
}

/**
 * Like `resolveStartupAuth`, but first honors `gitAuthLevel === "none"` by
 * skipping the mint entirely (used by the playtester subagent, which never
 * needs push access).
 */
export async function resolveSessionAuth(
  gitAuthLevel: GitAuthLevel,
  mintPolicy: () => Promise<MintedGitHubPolicy> = mintGitHubTokenPolicy,
  timeoutMs: number = TOKEN_MINT_TIMEOUT_MS,
  attempts: number = STARTUP_MINT_ATTEMPTS,
  gapMs: number = STARTUP_MINT_RETRY_GAP_MS,
): Promise<StartupAuthResult> {
  if (gitAuthLevel === "none") {
    return { policy: OPEN_NETWORK_POLICY, authed: false };
  }
  return resolveStartupAuth(mintPolicy, timeoutMs, attempts, gapMs);
}

export function buildSandboxDefinition(
  options: SandboxRecipeOptions,
): SandboxDefinition<
  VercelSandboxBootstrapUseOptions,
  VercelSandboxSessionUseOptions
> {
  return {
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
          screenshotTooling: options.screenshotTooling ?? false,
        }),
      });
      if (setup.exitCode !== 0)
        throw new Error(setup.stderr || "Sandbox pre-warming failed");
    },
    async onSession({ use }) {
      const auth = await resolveSessionAuth(options.gitAuthLevel);
      const sandbox = await use({
        networkPolicy: auth.policy,
        timeout: SANDBOX_TIMEOUT_MS,
      });
      if (options.gitAuthLevel === "push-capable" && auth.authed) {
        try {
          await sandbox.run({ command: AUTO_RECOVER_PUSH_COMMAND });
        } catch {}
      }
      if (options.gitAuthLevel !== "none") {
        keepTokenFresh(sandbox, mintFreshPolicyWithExpiry, {
          initialMs: initialTokenRefreshDelayMs(auth),
        });
      }
    },
  };
}

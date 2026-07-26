import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { getToken } from "@vercel/connect";
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

export const TOKEN_REFRESH_MS = 45 * 60 * 1000;

export const TOKEN_RETRY_MS = 30 * 1000;

export const TOKEN_MINT_TIMEOUT_MS = 10 * 1000;

export const MAX_SET_POLICY_FAILURES = 20;

export const MAX_MINT_FAILURES = 20;

export const SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000;

export const OPEN_NETWORK_POLICY: SandboxNetworkPolicy = { allow: { "*": [] } };

export async function githubNetworkPolicy(): Promise<SandboxNetworkPolicy> {
  const token = await getToken(
    "github/ts-rogue-eve-github",
    { subject: { type: "app" }, scopes: ["*"] },

    { forceRefresh: true },
  );
  const authorization = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  return {
    allow: {
      "github.com": [{ transform: [{ headers: { authorization } }] }],
      "*.github.com": [{ transform: [{ headers: { authorization } }] }],
      "*": [],
    },
  };
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

async function mintWithRetries(
  mintPolicy: () => Promise<SandboxNetworkPolicy>,
  attempts: number,
  perAttemptTimeoutMs: number,
  gapMs: number,
): Promise<SandboxNetworkPolicy> {
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
 * Resolves authenticated GitHub access, falling back to an open policy so an
 * existing workspace can still start.
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

/**
 * Refreshes sandbox authentication on unreferenced timers with bounded retry
 * chains, so refresh work cannot keep a serverless invocation alive.
 */
export function keepTokenFresh(
  sandbox: Pick<SandboxSession, "setNetworkPolicy">,
  mintPolicy: () => Promise<SandboxNetworkPolicy> = githubNetworkPolicy,
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
      let policy: SandboxNetworkPolicy;
      try {
        policy = await mintPolicy();
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
        await sandbox.setNetworkPolicy(policy);
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
      schedule(refreshMs);
    }, delayMs);

    timer.unref?.();
    return timer;
  };

  return schedule(initialMs);
}

export const mintFreshPolicy = () =>
  withTimeout(githubNetworkPolicy(), TOKEN_MINT_TIMEOUT_MS);

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

export async function resolveSessionNetworkPolicy(
  gitAuthLevel: GitAuthLevel,
  mintPolicy: () => Promise<SandboxNetworkPolicy> = githubNetworkPolicy,
  timeoutMs: number = TOKEN_MINT_TIMEOUT_MS,
  attempts: number = STARTUP_MINT_ATTEMPTS,
  gapMs: number = STARTUP_MINT_RETRY_GAP_MS,
): Promise<{ policy: SandboxNetworkPolicy; authed: boolean }> {
  if (gitAuthLevel === "none") {
    return { policy: OPEN_NETWORK_POLICY, authed: false };
  }
  return resolveStartupNetworkPolicy(mintPolicy, timeoutMs, attempts, gapMs);
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
      const { policy, authed } = await resolveSessionNetworkPolicy(
        options.gitAuthLevel,
      );
      const sandbox = await use({
        networkPolicy: policy,
        timeout: SANDBOX_TIMEOUT_MS,
      });
      if (options.gitAuthLevel === "push-capable" && authed) {
        try {
          await sandbox.run({ command: AUTO_RECOVER_PUSH_COMMAND });
        } catch {}
      }
      if (options.gitAuthLevel !== "none") {
        keepTokenFresh(sandbox, mintFreshPolicy, {
          initialMs: authed ? TOKEN_REFRESH_MS : TOKEN_RETRY_MS,
        });
      }
    },
  };
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { SandboxDefinition, SandboxSession } from "eve/sandbox";
import {
  type VercelSandboxBootstrapUseOptions,
  type VercelSandboxSessionUseOptions,
  vercel,
} from "eve/sandbox/vercel";

import {
  initialTokenRefreshDelayMs,
  keepTokenFresh,
  mintFreshPolicyWithExpiry,
  resolveBootstrapNetworkPolicy,
  resolveStartupAuth,
} from "./github-token";
import {
  buildOrientationBrief,
  GIT_FACTS_COMMAND,
  parseGitFacts,
  parseScreenshotToolingStatus,
  SCREENSHOT_STATUS_PATH,
} from "./orientation";

/** How long a sandbox may live before Vercel reclaims it. */
export const SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000;

/** Pinned so the bootstrap install and its test can't drift apart. */
export const MEX_AGENT_VERSION = "0.7.0";

/** Keys dependency snapshots by lockfile content, with the commit as a read-failure fallback. */
export function dependencyRevalidationKey(): string {
  try {
    const lock = readFileSync(
      new URL("../../../pnpm-lock.yaml", import.meta.url),
    );
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
    `(npm install -g mex-agent@${MEX_AGENT_VERSION} || true)`,

    ...(seedGitHubConfig
      ? ["git config --global --add safe.directory '*'"]
      : []),

    "git init -q -b main .",
    "git remote add origin https://github.com/zico-io/ts-rogue.git",
    "git fetch --depth 1 origin main",
    "git reset --hard origin/main",
    "corepack pnpm install --frozen-lockfile",
    `(mex graph || echo 'bootstrap: code-graph build failed; retrieval falls back to grep/read' >&2)`,
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

export interface SandboxRecipeOptions {
  /** Push access, plus the auto-recovery push and the orientation brief. */
  push?: boolean;

  screenshotTooling?: boolean;

  seedGitHubConfig?: boolean;
}

/** The one sandbox recipe; the root agent takes the push-capable variant. */
export function buildSandboxDefinition(
  options: SandboxRecipeOptions = {},
): SandboxDefinition<
  VercelSandboxBootstrapUseOptions,
  VercelSandboxSessionUseOptions
> {
  return {
    backend: vercel({
      timeout: SANDBOX_TIMEOUT_MS,
      env: { ...WORKSPACE_GIT_CONFIG_ENV, DO_NOT_TRACK: "1" },
    }),
    revalidationKey: dependencyRevalidationKey,
    async bootstrap({ use }) {
      const policy = await resolveBootstrapNetworkPolicy();
      const sandbox = await use({ networkPolicy: policy });
      const setup = await sandbox.run({
        command: buildBootstrapCommand({
          screenshotTooling: options.screenshotTooling ?? false,
          seedGitHubConfig: options.seedGitHubConfig ?? true,
        }),
      });
      if (setup.exitCode !== 0)
        throw new Error(setup.stderr || "Sandbox pre-warming failed");
    },
    async onSession({ use }) {
      const auth = await resolveStartupAuth();
      const sandbox = await use({
        networkPolicy: auth.policy,
        timeout: SANDBOX_TIMEOUT_MS,
      });

      if (options.push === true) {
        if (auth.authed) {
          try {
            await sandbox.run({ command: AUTO_RECOVER_PUSH_COMMAND });
          } catch {}
        }
        await writeOrientationBrief(sandbox, auth.authed);
      }

      keepTokenFresh(sandbox, mintFreshPolicyWithExpiry, {
        initialMs: initialTokenRefreshDelayMs(auth),
      });
    },
  };
}

const READ_SCREENSHOT_STATUS_COMMAND = `cat ${SCREENSHOT_STATUS_PATH} 2>/dev/null || true`;

/** Best-effort: a session still starts when the brief cannot be written. */
async function writeOrientationBrief(
  sandbox: Pick<SandboxSession, "run" | "writeTextFile">,
  githubAuthed: boolean,
): Promise<void> {
  try {
    const facts = await sandbox.run({ command: GIT_FACTS_COMMAND });
    const screenshotStatus = await sandbox.run({
      command: READ_SCREENSHOT_STATUS_COMMAND,
    });
    if (facts.exitCode !== 0) return;
    await sandbox.writeTextFile({
      path: "ORIENTATION.md",
      content: buildOrientationBrief(
        parseGitFacts(facts.stdout),
        parseScreenshotToolingStatus(screenshotStatus.stdout),
        githubAuthed,
      ),
    });
  } catch {}
}

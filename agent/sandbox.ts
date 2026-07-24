import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { getToken } from "@vercel/connect";
import {
  defineSandbox,
  type SandboxNetworkPolicy,
  type SandboxSession,
} from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import {
  buildOrientationBrief,
  GIT_FACTS_COMMAND,
  parseGitFacts,
  parseScreenshotToolingStatus,
  SCREENSHOT_STATUS_PATH,
} from "./lib/orientation";

// GitHub App installation tokens live ~1h; refresh the injected header well
// before that so a session that outlasts one token can still push.
const TOKEN_REFRESH_MS = 45 * 60 * 1000;
// After the authed mint fails (or startup fell back to unauthenticated), retry
// on a short cadence so push capability recovers within a couple of minutes of
// the token service healing, instead of waiting a full refresh cycle.
const TOKEN_RETRY_MS = 2 * 60 * 1000;
// Bound every token mint so a slow/degraded token service cannot block session
// startup or a refresh tick indefinitely.
const TOKEN_MINT_TIMEOUT_MS = 10 * 1000;
// Consecutive setNetworkPolicy failures tolerated before treating the sandbox as
// gone - survives a transient blip (~10min at the retry cadence) without killing refresh.
export const MAX_SET_POLICY_FAILURES = 5;

// Unauthenticated fallback: allow every host with no header injection. Public
// clone/fetch and the npm registry still work; only authenticated `git push`
// loses its credential - a recoverable, late-phase blocker the agent already
// surfaces - instead of the whole session hanging on a token blip.
const OPEN_NETWORK_POLICY: SandboxNetworkPolicy = { allow: { "*": [] } };

async function githubNetworkPolicy(): Promise<SandboxNetworkPolicy> {
  const token = await getToken("github/ts-rogue-eve-github", {
    subject: { type: "app" },
    scopes: ["*"],
  });
  const authorization = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  return {
    allow: {
      "github.com": [{ transform: [{ headers: { authorization } }] }],
      "*.github.com": [{ transform: [{ headers: { authorization } }] }],
      "*": [],
    },
  };
}

// Reject after `ms` so a token mint that never settles cannot wedge whatever is
// awaiting it. The losing promise is caught so a late rejection never surfaces
// as an unhandled rejection.
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

// Resolve the network policy to install at session/bootstrap start WITHOUT ever
// letting GitHub-token trouble kill the session. The credential is needed only
// for the late push/PR step, not for the model loop, file reads, `pnpm check`,
// or Linear activity posting - so on timeout or failure we come up with the
// open policy and let keepTokenFresh upgrade to authed once the service heals.
// This is the fix for silent resume stalls: previously `onSession` did
// `await githubNetworkPolicy()` unconditionally, so a hung/failing token mint
// blocked the turn before it started and nothing was ever posted to Linear.
export async function resolveStartupNetworkPolicy(
  mintPolicy: () => Promise<SandboxNetworkPolicy> = githubNetworkPolicy,
  timeoutMs: number = TOKEN_MINT_TIMEOUT_MS,
): Promise<{ policy: SandboxNetworkPolicy; authed: boolean }> {
  try {
    return { policy: await withTimeout(mintPolicy(), timeoutMs), authed: true };
  } catch {
    return { policy: OPEN_NETWORK_POLICY, authed: false };
  }
}

/** Timing for {@link keepTokenFresh}. A bare number sets every cadence equal. */
export interface TokenRefreshTiming {
  /** Delay between successful re-mints. */
  refreshMs?: number;
  /** Delay between attempts after a failed mint (fast, to recover push soon). */
  retryMs?: number;
  /** Delay before the first attempt (retry cadence when startup was unauthed). */
  initialMs?: number;
}

// Re-mint the frozen auth header on an interval (it expires mid-session). A mint
// failure or a transient setNetworkPolicy blip reschedules on the retry cadence;
// the chain stops only after MAX_SET_POLICY_FAILURES consecutive setNetworkPolicy
// failures (sandbox torn down - there's no session-end hook).
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
  const schedule = (delayMs: number): ReturnType<typeof setTimeout> =>
    setTimeout(async () => {
      let policy: SandboxNetworkPolicy;
      try {
        policy = await mintPolicy();
      } catch {
        // Token service down/slow: keep the current policy, retry soon.
        schedule(retryMs);
        return;
      }
      try {
        await sandbox.setNetworkPolicy(policy);
      } catch {
        // Retry (could be a blip); give up only once we're sure it's torn down.
        if (++setPolicyFailures >= MAX_SET_POLICY_FAILURES) return;
        schedule(retryMs);
        return;
      }
      setPolicyFailures = 0;
      schedule(refreshMs);
    }, delayMs);

  return schedule(initialMs);
}

// Refresh mint is bounded too: a hung getToken during a refresh tick would
// otherwise never reschedule and silently stop keeping the token fresh.
const mintFreshPolicy = () =>
  withTimeout(githubNetworkPolicy(), TOKEN_MINT_TIMEOUT_MS);

// Cache the bootstrap-baked node_modules across commits: key the snapshot on the
// dependency lockfile, not the commit SHA. eve evaluates this at build time and
// freezes it; combined with eve's automatic tracking of authored sandbox source,
// the snapshot rebuilds only when pnpm-lock.yaml or this file (tool pins) changes,
// and is reused otherwise. onSession re-fetches main, so source stays current.
// Fall back to the commit SHA if the lockfile is unreadable, so a failed read
// never silently serves stale modules.
export function dependencyRevalidationKey(): string {
  try {
    const lock = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url));
    return `deps:${createHash("sha256").update(lock).digest("hex")}`;
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  }
}

/**
 * The base image's default `/etc/apt/sources.list.d/ubuntu.sources` points at
 * `http://archive.ubuntu.com`/`http://security.ubuntu.com`; plain HTTP egress
 * is blocked at the sandbox network layer (HTTPS is not), so every apt
 * operation below used to silently no-op without this rewrite - which is
 * exactly how `playwright install --with-deps` failed: the browser's shared
 * libraries (`libglib-2.0.so.0` and friends) never installed, so
 * `scripts/play-web.mjs`'s screenshots could never launch chromium, and
 * nothing surfaced that until an agent tried to use it mid-task and burned a
 * network-locked-down runtime session discovering it by hand.
 */
const USE_HTTPS_APT_MIRRORS_COMMAND =
  "sudo sed -i 's#http://archive.ubuntu.com#https://archive.ubuntu.com#; s#http://security.ubuntu.com#https://security.ubuntu.com#' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || true";

/**
 * Builds the sandbox pre-warm command: system packages, repo clone,
 * dependency install, and the Playwright chromium `scripts/play-web.mjs`'s
 * screenshots depend on. Exported (rather than inlined in `bootstrap` below)
 * so its content - in particular, that it actually verifies chromium can
 * launch instead of trusting the install step - is directly testable.
 *
 * The chromium install is **verified, not just attempted**: it used to
 * silently swallow failures with a bare `|| true`, so a broken image kept
 * failing the same way, invisibly, every session revalidation until an agent
 * discovered it by hand mid-task. Failure is still non-fatal to the overall
 * pre-warm (a locked-down image must not fail bootstrap outright), but it's
 * now recorded to {@link SCREENSHOT_STATUS_PATH} either way, so `onSession`
 * can fold a definitive answer into `ORIENTATION.md` instead of a session
 * finding out the hard way.
 */
export function buildBootstrapCommand(): string {
  const verifyChromiumLaunches = `node -e "require('playwright').chromium.launch().then(b=>b.close())"`;
  const installScreenshotTooling = [
    "mkdir -p /workspace/.eve",
    `(corepack pnpm exec playwright install --with-deps chromium && ${verifyChromiumLaunches} && echo '{"available":true}' > ${SCREENSHOT_STATUS_PATH})`,
    `|| echo '{"available":false,"reason":"playwright chromium failed to install or launch during sandbox bootstrap"}' > ${SCREENSHOT_STATUS_PATH}`,
  ].join(" ");

  return [
    // tmux backs the terminal play harness (scripts/play.sh), pi backs its
    // interactive `play dev` layout, and Playwright's chromium backs the web
    // play harness (scripts/play-web.mjs), so the agent can drive and
    // screenshot both renderers in-sandbox. ripgrep/fd-find/bat/eza are the
    // agent-friendly replacements for grep/find/cat/ls (faster, .gitignore
    // aware, better defaults - see HAR-3); ast-grep adds structural
    // (syntax-tree) code search on top of them for refactors and call-site
    // queries plain text search can't express.
    USE_HTTPS_APT_MIRRORS_COMMAND,
    "(sudo apt-get update && sudo apt-get install -y tmux ripgrep fd-find bat eza) || true",
    // Debian/Ubuntu ship fd-find/bat under the `fdfind`/`batcat` binary names
    // to avoid clashing with unrelated packages already named `fd`/`bat`;
    // symlink the conventional names onto PATH so agents and scripts can
    // invoke `fd`/`bat` directly instead of learning the distro rename.
    "(sudo ln -sf /usr/bin/fdfind /usr/local/bin/fd || true)",
    "(sudo ln -sf /usr/bin/batcat /usr/local/bin/bat || true)",
    "(npm install -g @earendil-works/pi-coding-agent@0.81.1 || true)",
    "(npm install -g @ast-grep/cli || true)",
    "git config --global --add safe.directory /workspace",
    "git clone https://github.com/zico-io/ts-rogue.git .",
    "corepack pnpm install --frozen-lockfile",
    installScreenshotTooling,
  ].join(" && ");
}

/** Reads back the bootstrap-written screenshot-tooling status; always exits 0 (missing file reads as unavailable via `parseScreenshotToolingStatus`). */
const READ_SCREENSHOT_STATUS_COMMAND = `cat ${SCREENSHOT_STATUS_PATH} 2>/dev/null || true`;

/**
 * Resyncs local `main` to `origin/main` - but only when HEAD is already on
 * `main`. `onSession` can re-run mid-session (e.g. a new inbound Linear
 * activity re-attaches the same sandbox), and unconditionally
 * `git checkout -B main FETCH_HEAD` here used to discard whatever branch and
 * commits the agent had checked out in between, with no warning, the moment
 * the sandbox reconnected - including commits that hadn't been pushed yet
 * (e.g. during a transient GitHub-auth outage). Once the agent has moved off
 * `main` onto its own branch, this leaves it alone; the agent's own
 * `git fetch origin main && git rebase origin/main` (see `instructions.md`)
 * is how it picks up new upstream commits from there.
 */
export const SYNC_MAIN_COMMAND = [
  "git fetch --depth 1 origin main",
  'CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"',
  'if [ "$CURRENT_BRANCH" = "main" ]; then git checkout -B main FETCH_HEAD; ' +
    "else echo \"onSession: HEAD is on '$CURRENT_BRANCH', not main - leaving it in place instead of resyncing\"; fi",
].join(" && ");

export default defineSandbox({
  backend: vercel(),
  revalidationKey: dependencyRevalidationKey,
  async bootstrap({ use }) {
    const { policy } = await resolveStartupNetworkPolicy();
    const sandbox = await use({ networkPolicy: policy });
    const setup = await sandbox.run({ command: buildBootstrapCommand() });
    if (setup.exitCode !== 0)
      throw new Error(setup.stderr || "Sandbox pre-warming failed");
  },
  async onSession({ use }) {
    const { policy, authed } = await resolveStartupNetworkPolicy();
    const sandbox = await use({ networkPolicy: policy });
    const sync = await sandbox.run({ command: SYNC_MAIN_COMMAND });
    if (sync.exitCode !== 0)
      throw new Error(sync.stderr || "Sandbox repository sync failed");
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

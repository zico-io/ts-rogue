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
// on a short cadence so push capability recovers within tens of seconds of the
// token service healing, instead of an agent burning several minutes retrying
// `git push` by hand against a still-unauthenticated policy (see HAR-5: a
// session saw ~20 minutes of push/API failures because the old 2-minute retry
// cadence checked far too infrequently during a startup-time credential blip).
const TOKEN_RETRY_MS = 30 * 1000;
// Bound every token mint so a slow/degraded token service cannot block session
// startup or a refresh tick indefinitely.
const TOKEN_MINT_TIMEOUT_MS = 10 * 1000;
// Consecutive setNetworkPolicy failures tolerated before treating the sandbox as
// gone. Kept at the same ~10-minute total endurance as before (failures *
// TOKEN_RETRY_MS), just checked more often now that TOKEN_RETRY_MS is shorter,
// so recovery from a transient blip is faster without giving up on a longer
// outage any sooner.
export const MAX_SET_POLICY_FAILURES = 20;
// Sandbox max lifetime, passed at create AND re-asserted on every session
// attach (create options don't apply to resumed sandboxes). Without this,
// eve's Vercel backend defaults Sandbox.create to a 30-minute timeout; when it
// elapsed mid-task, eve silently recreated the session sandbox from the
// template snapshot and the local branch state - including unpushed commits -
// was gone (ROG-65). 5h is the Vercel Sandbox platform ceiling.
export const SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000;

// Unauthenticated fallback: allow every host with no header injection. Public
// clone/fetch and the npm registry still work; only authenticated `git push`
// loses its credential - a recoverable, late-phase blocker the agent already
// surfaces - instead of the whole session hanging on a token blip.
const OPEN_NETWORK_POLICY: SandboxNetworkPolicy = { allow: { "*": [] } };

async function githubNetworkPolicy(): Promise<SandboxNetworkPolicy> {
  const token = await getToken(
    "github/ts-rogue-eve-github",
    { subject: { type: "app" }, scopes: ["*"] },
    // Bypass @vercel/connect's in-process token cache: it serves a cached
    // token until 30 seconds before its ~1h expiry, which turned the 45-minute
    // refresh tick into a no-op re-install of the same dying token - pushes
    // then failed from ~60min until the 90min tick. Every caller of this
    // function is a deliberate refresh point that wants a genuinely fresh
    // token, and mints happen at most a few times an hour, so skipping the
    // cache costs one Connect roundtrip and nothing else.
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

// Coming up unauthenticated at session start means every push fails outright
// until the next background refresh tick (TOKEN_RETRY_MS later), so it's worth
// a couple of quick attempts before conceding that fallback - a single
// TOKEN_MINT_TIMEOUT_MS window is sometimes too tight for a token service
// that's merely slow to warm up rather than actually down (see HAR-5).
const STARTUP_MINT_ATTEMPTS = 2;
const STARTUP_MINT_RETRY_GAP_MS = 3 * 1000;

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
  attempts: number = STARTUP_MINT_ATTEMPTS,
  gapMs: number = STARTUP_MINT_RETRY_GAP_MS,
): Promise<{ policy: SandboxNetworkPolicy; authed: boolean }> {
  try {
    return {
      policy: await mintWithRetries(mintPolicy, attempts, timeoutMs, gapMs),
      authed: true,
    };
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
      } catch (err) {
        // Token service down/slow: keep the current policy, retry soon. Warn
        // rather than stay silent - an incident where pushes died for an hour
        // was undiagnosable because every failure here was swallowed.
        console.warn(
          `keepTokenFresh: token mint failed, retrying in ${retryMs}ms:`,
          err instanceof Error ? err.message : err,
        );
        schedule(retryMs);
        return;
      }
      try {
        await sandbox.setNetworkPolicy(policy);
      } catch (err) {
        // Retry (could be a blip); give up only once we're sure it's torn down.
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

  return schedule(initialMs);
}

// Refresh mint is bounded too: a hung getToken during a refresh tick would
// otherwise never reschedule and silently stop keeping the token fresh.
// Exported for the turn-start re-mint in hooks/prewarm-sandbox.ts.
export const mintFreshPolicy = () =>
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
 * `gh` refuses to run most commands (`gh pr create`, `gh api`, ...) unless it
 * thinks it's logged in, but the real GitHub credential must never enter the
 * sandbox process (see `githubNetworkPolicy` above - that's the whole point
 * of brokering it at the network boundary). So seed `gh`'s own config file
 * with a placeholder token that satisfies just the local login check: every
 * request `gh` sends to `github.com`/`*.github.com` has its `Authorization`
 * header overwritten by the network-boundary broker before it leaves the
 * sandbox, exactly like `git push` (and the `curl`-based PR calls this
 * replaces, HAR-14) already work with no real secret on disk. Baking this
 * placeholder into the snapshot is safe - it authenticates nothing by
 * itself and is worthless outside a sandbox whose egress firewall rewrites
 * it.
 */
const SEED_GH_CLI_AUTH_COMMAND = [
  'mkdir -p "$HOME/.config/gh"',
  `printf 'github.com:\n    oauth_token: placeholder-overwritten-by-network-broker\n    git_protocol: https\n' > "$HOME/.config/gh/hosts.yml"`,
].join(" && ");

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
    // The `(…) || echo` probe-with-fallback is one shell clause, so it stays a
    // single element; joining with " && " below keeps a real operator between
    // `mkdir` and the subshell. A bare-space join here produced
    // `mkdir -p /workspace/.eve (…)` - a subshell juxtaposed to a command with
    // no operator - which is a bash syntax error that failed every deploy.
    `(corepack pnpm exec playwright install --with-deps chromium && ${verifyChromiumLaunches} && echo '{"available":true}' > ${SCREENSHOT_STATUS_PATH}) || echo '{"available":false,"reason":"playwright chromium failed to install or launch during sandbox bootstrap"}' > ${SCREENSHOT_STATUS_PATH}`,
  ].join(" && ");

  return [
    // tmux backs the terminal play harness (scripts/play.sh), pi backs its
    // interactive `play dev` layout, and Playwright's chromium backs the web
    // play harness (scripts/play-web.mjs), so the agent can drive and
    // screenshot both renderers in-sandbox. ripgrep/fd-find/bat/eza are the
    // agent-friendly replacements for grep/find/cat/ls (faster, .gitignore
    // aware, better defaults - see HAR-3); ast-grep adds structural
    // (syntax-tree) code search on top of them for refactors and call-site
    // queries plain text search can't express. `gh` replaces raw `curl` +
    // the GitHub REST API for pull-request operations (HAR-14).
    USE_HTTPS_APT_MIRRORS_COMMAND,
    "(sudo apt-get update && sudo apt-get install -y tmux ripgrep fd-find bat eza gh) || true",
    // Debian/Ubuntu ship fd-find/bat under the `fdfind`/`batcat` binary names
    // to avoid clashing with unrelated packages already named `fd`/`bat`;
    // symlink the conventional names onto PATH so agents and scripts can
    // invoke `fd`/`bat` directly instead of learning the distro rename.
    "(sudo ln -sf /usr/bin/fdfind /usr/local/bin/fd || true)",
    "(sudo ln -sf /usr/bin/batcat /usr/local/bin/bat || true)",
    SEED_GH_CLI_AUTH_COMMAND,
    "(npm install -g @earendil-works/pi-coding-agent@0.81.1 || true)",
    // Ponytail is a YAGNI/minimal-diff ruleset for coding agents (see
    // https://github.com/DietrichGebert/ponytail); `pi install` fetches it as
    // an extension so pi's `play dev` sessions inherit the same
    // lazy-senior-dev discipline this repo already partially adopted (the
    // `ponytail:` comment convention for flagged simplifications, see
    // instructions.md).
    "(pi install git:github.com/DietrichGebert/ponytail || true)",
    "(npm install -g @ast-grep/cli || true)",
    // '*' rather than /workspace: ralph mode adds worktrees under
    // /workspace/.worktrees/<issue-id>, and safe.directory entries are
    // exact-path, so the single /workspace entry would leave every worktree
    // raising "dubious ownership".
    "git config --global --add safe.directory '*'",
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

/**
 * Best-effort recovery for commits stranded by a prior push failure (HAR-5):
 * once this session has confirmed GitHub auth, flush anything left unpushed on
 * a non-main branch before the agent even starts, instead of relying on it to
 * remember to retry. A branch with no upstream yet is pushed with `-u`; a
 * branch with an upstream but commits ahead of it is pushed plainly. Never
 * fatal - a failed auto-push here just leaves the commits in place for the
 * agent's own retry (and `ORIENTATION.md`'s unpushed-commit line reports it).
 * `GIT_TERMINAL_PROMPT=0` guarantees a fast failure instead of a hang if auth
 * turns out to be stale.
 */
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

export default defineSandbox({
  backend: vercel({ timeout: SANDBOX_TIMEOUT_MS }),
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
    // `timeout` re-ups the lifetime ceiling on every attach: the backend's
    // create-time value (above) never reaches resumed sandboxes, and `use`
    // options land in the SDK's `Sandbox.update`, which accepts it.
    const sandbox = await use({
      networkPolicy: policy,
      timeout: SANDBOX_TIMEOUT_MS,
    });
    const sync = await sandbox.run({ command: SYNC_MAIN_COMMAND });
    if (sync.exitCode !== 0)
      throw new Error(sync.stderr || "Sandbox repository sync failed");
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

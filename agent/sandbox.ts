import { getToken } from "@vercel/connect";
import {
  defineSandbox,
  type SandboxNetworkPolicy,
  type SandboxSession,
} from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

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

// The auth header is frozen into the firewall policy at session start, so a
// static token expires mid-session. Re-mint it on an interval via
// setNetworkPolicy. There is no session-end hook, so the chain self-terminates
// when setNetworkPolicy throws (sandbox torn down) rather than leaking a timer.
// A transient mint failure must NOT end refresh: it reschedules on the retry
// cadence (fast) while a torn-down sandbox stops, and a success settles back to
// the slow refresh cadence.
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
        // setNetworkPolicy only fails once the sandbox is gone; stop the chain.
        return;
      }
      schedule(refreshMs);
    }, delayMs);

  return schedule(initialMs);
}

// Refresh mint is bounded too: a hung getToken during a refresh tick would
// otherwise never reschedule and silently stop keeping the token fresh.
const mintFreshPolicy = () =>
  withTimeout(githubNetworkPolicy(), TOKEN_MINT_TIMEOUT_MS);

export default defineSandbox({
  backend: vercel(),
  revalidationKey: () => process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  async bootstrap({ use }) {
    const { policy } = await resolveStartupNetworkPolicy();
    const sandbox = await use({ networkPolicy: policy });
    const setup = await sandbox.run({
      command:
        // tmux backs the terminal play harness (scripts/play.sh) and Playwright's
        // chromium backs the web play harness (scripts/play-web.mjs), so the agent
        // can drive and screenshot both renderers in-sandbox. Install the browser
        // now, while the pre-warm network policy is open (a locked-down runtime
        // policy can block the browser CDN). `|| true` keeps a locked-down image
        // from failing the whole pre-warm if either install is unavailable.
        "(sudo apt-get update && sudo apt-get install -y tmux || true) && git config --global --add safe.directory /workspace && git clone https://github.com/zico-io/ts-rogue.git . && corepack pnpm install --frozen-lockfile && (corepack pnpm exec playwright install --with-deps chromium || true)",
    });
    if (setup.exitCode !== 0)
      throw new Error(setup.stderr || "Sandbox pre-warming failed");
  },
  async onSession({ use }) {
    const { policy, authed } = await resolveStartupNetworkPolicy();
    const sandbox = await use({ networkPolicy: policy });
    const sync = await sandbox.run({
      command:
        "git fetch --depth 1 origin main && git checkout -B main FETCH_HEAD",
    });
    if (sync.exitCode !== 0)
      throw new Error(sync.stderr || "Sandbox repository sync failed");
    // If startup couldn't mint the token, retry soon so push recovers fast;
    // otherwise refresh on the normal cadence.
    keepTokenFresh(sandbox, mintFreshPolicy, {
      initialMs: authed ? TOKEN_REFRESH_MS : TOKEN_RETRY_MS,
    });
  },
});

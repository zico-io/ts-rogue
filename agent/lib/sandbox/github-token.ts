import { getTokenResponse } from "@vercel/connect";
import type { SandboxNetworkPolicy, SandboxSession } from "eve/sandbox";

// GitHub credentials reach the sandbox as a network policy, never as an env
// var or a file. This module mints that policy and keeps it fresh for the
// life of the sandbox; `recipe.ts` decides which sandboxes get one.

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

/** Requires authenticated GitHub access because bootstrap clones a private repository. */
export async function resolveBootstrapNetworkPolicy(
  resolve: () => Promise<{
    policy: SandboxNetworkPolicy;
    authed: boolean;
  }> = resolveStartupAuth,
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
  timing: TokenRefreshTiming = {},
) {
  const refreshMs = timing.refreshMs ?? TOKEN_REFRESH_MS;
  const retryMs = timing.retryMs ?? TOKEN_RETRY_MS;
  const initialMs = timing.initialMs ?? refreshMs;

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

export const mintFreshPolicyWithExpiry = () =>
  withTimeout(mintGitHubTokenPolicy(), TOKEN_MINT_TIMEOUT_MS);

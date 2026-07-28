import { getTokenResponse } from "@vercel/connect";
import type { SandboxNetworkPolicy, SandboxSession } from "eve/sandbox";

/** Ceiling on how long `keepTokenFresh` waits between successful refreshes. */
export const TOKEN_REFRESH_MS = 45 * 60 * 1000;

/** Floor on any scheduled refresh, so a short-lived token cannot cause a tight loop. */
export const MIN_TOKEN_REFRESH_MS = 5 * 60 * 1000;

/** Runway left before a token's real expiry, sized to outlast the retry chain (HAR-69). */
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
 * Mints a GitHub network policy, bypassing Connect's token cache so every caller
 * gets a genuinely fresh token rather than a cached dying one (ed6e164).
 */
export async function mintGitHubTokenPolicy(): Promise<MintedGitHubPolicy> {
  const response = await getTokenResponse(
    "github/ts-rogue-eve-github",
    { subject: { type: "app" }, scopes: ["*"] },
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

/** `onSession`'s session-start auth outcome. */
export interface StartupAuthResult {
  policy: SandboxNetworkPolicy;

  authed: boolean;

  /** The minted token's real expiry, in epoch ms; unset when unauthed. */
  expiresAtMs?: number;
}

/**
 * Resolves authenticated GitHub access, falling back to an open policy so an
 * existing workspace can still start.
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

/** Computes `keepTokenFresh`'s first delay from a session-start `StartupAuthResult`. */
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
 * chains, re-scheduling off each minted token's real expiry.
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

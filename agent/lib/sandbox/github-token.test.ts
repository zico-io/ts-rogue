import { getTokenResponse } from "@vercel/connect";
import type { SandboxNetworkPolicy } from "eve/sandbox";
import { describe, expect, it, vi } from "vitest";

const FAR_FUTURE_EXPIRY_MS = Date.now() + 999_999_999;

vi.mock("@vercel/connect", () => ({
  getTokenResponse: vi.fn(() =>
    Promise.resolve({ token: "fresh-token", expiresAt: FAR_FUTURE_EXPIRY_MS }),
  ),
}));

import {
  initialTokenRefreshDelayMs,
  keepTokenFresh,
  MAX_MINT_FAILURES,
  MAX_SET_POLICY_FAILURES,
  MIN_TOKEN_REFRESH_MS,
  type MintedGitHubPolicy,
  mintFreshPolicyWithExpiry,
  nextRefreshDelayMs,
  resolveBootstrapNetworkPolicy,
  resolveStartupAuth,
  TOKEN_EXPIRY_BUFFER_MS,
  TOKEN_REFRESH_MS,
} from "./github-token";

function minted(
  policy: SandboxNetworkPolicy,
  expiresAtMs: number = FAR_FUTURE_EXPIRY_MS,
): MintedGitHubPolicy {
  return { policy, expiresAtMs };
}

describe("nextRefreshDelayMs", () => {
  it("leaves TOKEN_EXPIRY_BUFFER_MS of runway before a token's real expiry", () => {
    const now = 1_000_000;
    const expiresAtMs = now + 25 * 60 * 1000;
    const delay = nextRefreshDelayMs(expiresAtMs, 45 * 60 * 1000, now);
    expect(delay).toBe(25 * 60 * 1000 - TOKEN_EXPIRY_BUFFER_MS);
  });

  it("never schedules past the ceiling even for a very long-lived token", () => {
    const now = 1_000_000;
    const expiresAtMs = now + 5 * 60 * 60 * 1000;
    const delay = nextRefreshDelayMs(expiresAtMs, 45 * 60 * 1000, now);
    expect(delay).toBe(45 * 60 * 1000);
  });

  it("floors at MIN_TOKEN_REFRESH_MS instead of refreshing immediately when the token is nearly expired", () => {
    const now = 1_000_000;
    const expiresAtMs = now + 60 * 1000;
    const delay = nextRefreshDelayMs(expiresAtMs, 45 * 60 * 1000, now);
    expect(delay).toBe(MIN_TOKEN_REFRESH_MS);
  });
});

describe("keepTokenFresh", () => {
  it("re-mints and re-applies the policy on each interval", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const policies: SandboxNetworkPolicy[] = [
      { allow: { a: [] } } as SandboxNetworkPolicy,
      { allow: { b: [] } } as SandboxNetworkPolicy,
    ];
    let n = 0;

    keepTokenFresh(sandbox, () => Promise.resolve(minted(policies[n++])), {
      refreshMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(applied).toEqual(policies);
    vi.useRealTimers();
  });

  it("retries on a transient mint failure instead of stopping", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    let call = 0;
    const mintPolicy = () => {
      call++;
      return call === 1
        ? Promise.reject(new Error("token service blip"))
        : Promise.resolve(minted(good));
    };

    keepTokenFresh(sandbox, mintPolicy, { refreshMs: 1000, retryMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(applied).toEqual([good]);
    vi.useRealTimers();
  });

  it("retries fast after a mint failure, then settles to the slow refresh cadence", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    let call = 0;
    const mintPolicy = () => {
      call++;
      return call === 1
        ? Promise.reject(new Error("token service down"))
        : Promise.resolve(minted(good));
    };

    keepTokenFresh(sandbox, mintPolicy, {
      refreshMs: 10000,
      retryMs: 1000,
      initialMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(9000);
    expect(applied).toEqual([good, good]);
    vi.useRealTimers();
  });

  it("recovers from a transient setNetworkPolicy blip instead of stopping", async () => {
    vi.useFakeTimers();
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    const applied: SandboxNetworkPolicy[] = [];
    let call = 0;
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        call++;

        if (call === 1) return Promise.reject(new Error("transient blip"));
        applied.push(policy);
        return Promise.resolve();
      },
    };

    keepTokenFresh(sandbox, () => Promise.resolve(minted(good)), {
      refreshMs: 1000,
      retryMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(applied).toEqual([good, good]);
    vi.useRealTimers();
  });

  it("gives up only after MAX_SET_POLICY_FAILURES consecutive failures (sandbox torn down)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const sandbox = {
      setNetworkPolicy: () => {
        calls++;
        return Promise.reject(new Error("sandbox torn down"));
      },
    };

    keepTokenFresh(
      sandbox,
      () => Promise.resolve(minted({ allow: {} } as SandboxNetworkPolicy)),
      { refreshMs: 1000, retryMs: 1000 },
    );

    await vi.advanceTimersByTimeAsync(1000 * (MAX_SET_POLICY_FAILURES + 5));

    expect(calls).toBe(MAX_SET_POLICY_FAILURES);
    vi.useRealTimers();
  });

  it("gives up after MAX_MINT_FAILURES consecutive mint failures instead of retrying forever", async () => {
    vi.useFakeTimers();
    let mints = 0;
    const sandbox = { setNetworkPolicy: () => Promise.resolve() };

    keepTokenFresh(
      sandbox,
      () => {
        mints++;
        return Promise.reject(new Error("vc link refresh path"));
      },
      { refreshMs: 1000, retryMs: 1000 },
    );
    await vi.advanceTimersByTimeAsync(1000 * (MAX_MINT_FAILURES + 5));

    expect(mints).toBe(MAX_MINT_FAILURES);
    vi.useRealTimers();
  });

  it("resets the mint-failure count on a successful mint", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    let call = 0;

    const mintPolicy = () => {
      call++;
      return call === MAX_MINT_FAILURES
        ? Promise.resolve(minted(good))
        : Promise.reject(new Error("still down"));
    };

    keepTokenFresh(sandbox, mintPolicy, { refreshMs: 1000, retryMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000 * (MAX_MINT_FAILURES + 2));

    expect(applied).toEqual([good]);
    expect(call).toBeGreaterThan(MAX_MINT_FAILURES);
    vi.useRealTimers();
  });

  it("schedules the next refresh off the token's real expiry instead of the fixed ceiling (HAR-69)", async () => {
    vi.useFakeTimers();
    const applied: SandboxNetworkPolicy[] = [];
    const sandbox = {
      setNetworkPolicy: (policy: SandboxNetworkPolicy) => {
        applied.push(policy);
        return Promise.resolve();
      },
    };
    const good = { allow: { b: [] } } as SandboxNetworkPolicy;
    const now = Date.now();
    const initialMs = 1000;
    // Expires 25 minutes after the first mint actually runs; with a
    // 20-minute buffer, the next refresh should land at the 5-minute mark,
    // well short of the 45-minute ceiling.
    const shortLivedExpiry = now + initialMs + 25 * 60 * 1000;
    const expectedNextDelayMs = 5 * 60 * 1000;

    keepTokenFresh(
      sandbox,
      () => Promise.resolve(minted(good, shortLivedExpiry)),
      {
        refreshMs: 45 * 60 * 1000,
        retryMs: 1000,
        initialMs,
      },
    );
    await vi.advanceTimersByTimeAsync(initialMs);
    expect(applied).toEqual([good]);

    // Just short of the expiry-derived 5-minute mark: no second refresh yet.
    await vi.advanceTimersByTimeAsync(expectedNextDelayMs - 1);
    expect(applied).toEqual([good]);

    await vi.advanceTimersByTimeAsync(1);
    expect(applied).toEqual([good, good]);
    vi.useRealTimers();
  });

  it("schedules unref'd timers so a pending tick never holds a serverless invocation open", () => {
    const timer = keepTokenFresh(
      { setNetworkPolicy: () => Promise.resolve() },
      () => Promise.resolve(minted({ allow: {} } as SandboxNetworkPolicy)),
      { refreshMs: 60_000 },
    );

    expect(timer.hasRef()).toBe(false);
    clearTimeout(timer);
  });
});

describe("mintFreshPolicyWithExpiry", () => {
  it("bypasses @vercel/connect's token cache with forceRefresh", async () => {
    vi.mocked(getTokenResponse).mockClear();
    const { policy } = await mintFreshPolicyWithExpiry();

    expect(getTokenResponse).toHaveBeenCalledWith(
      "github/ts-rogue-eve-github",
      { subject: { type: "app" }, scopes: ["*"] },
      { forceRefresh: true },
    );
    const header = `Basic ${Buffer.from("x-access-token:fresh-token").toString("base64")}`;
    const injected = [{ transform: [{ headers: { authorization: header } }] }];
    expect(policy).toEqual({
      allow: {
        "github.com": injected,
        "*.github.com": injected,
        "*": [],
      },
    });
  });

  it("also reports the token's real expiry, so callers can schedule off it (HAR-69)", async () => {
    const { policy, expiresAtMs } = await mintFreshPolicyWithExpiry();

    expect(expiresAtMs).toBe(FAR_FUTURE_EXPIRY_MS);
    expect(
      (policy as { allow: Record<string, unknown> }).allow["github.com"],
    ).toBeDefined();
  });
});

describe("resolveStartupAuth", () => {
  it("surfaces the minted token's real expiry alongside the policy (HAR-69/HAR-72)", async () => {
    const authedPolicy = { allow: { x: [] } } as SandboxNetworkPolicy;
    const expiresAtMs = Date.now() + 40 * 60 * 1000;

    const res = await resolveStartupAuth(
      () => Promise.resolve(minted(authedPolicy, expiresAtMs)),
      1000,
    );

    expect(res).toEqual({ policy: authedPolicy, authed: true, expiresAtMs });
  });

  it("falls back to the open policy with no expiry when every mint attempt fails", async () => {
    const res = await resolveStartupAuth(
      () => Promise.reject(new Error("token down")),
      1000,
      1,
    );

    expect(res).toEqual({ policy: { allow: { "*": [] } }, authed: false });
  });

  it("feeds a real mint's short-lived expiry into onSession's actual scheduling function (HAR-72)", async () => {
    // Drives resolveStartupAuth's real output into initialTokenRefreshDelayMs
    // (see StartupAuthResult) instead of re-deriving the schedule inline.
    const now = Date.now();
    const shortLivedExpiry = now + 25 * 60 * 1000;

    const auth = await resolveStartupAuth(
      () =>
        Promise.resolve(
          minted(
            { allow: { x: [] } } as SandboxNetworkPolicy,
            shortLivedExpiry,
          ),
        ),
      1000,
    );

    const initialMs = initialTokenRefreshDelayMs(auth);

    expect(initialMs).toBeLessThan(TOKEN_REFRESH_MS);
    expect(initialMs).toBe(5 * 60 * 1000);
  });

  it("falls back when the mint hangs past the timeout (no silent stall)", async () => {
    vi.useFakeTimers();
    const pending = resolveStartupAuth(
      () => new Promise<MintedGitHubPolicy>(() => {}),
      1000,
      1,
    );
    await vi.advanceTimersByTimeAsync(1000);
    const res = await pending;

    expect(res.authed).toBe(false);
    expect(res.policy).toEqual({ allow: { "*": [] } });
    vi.useRealTimers();
  });

  it("retries a transient startup blip and comes up authed instead of falling back", async () => {
    vi.useFakeTimers();
    const good = { allow: { x: [] } } as SandboxNetworkPolicy;
    let call = 0;
    const mintPolicy = () => {
      call++;
      return call === 1
        ? Promise.reject(new Error("startup blip"))
        : Promise.resolve(minted(good));
    };

    const pending = resolveStartupAuth(mintPolicy, 1000, 2, 500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(500);
    const res = await pending;

    expect(res.policy).toEqual(good);
    expect(res.authed).toBe(true);
    expect(call).toBe(2);
    vi.useRealTimers();
  });

  it("falls back to open only after exhausting every retry attempt", async () => {
    vi.useFakeTimers();
    let call = 0;
    const mintPolicy = () => {
      call++;
      return Promise.reject(new Error("still down"));
    };

    const pending = resolveStartupAuth(mintPolicy, 1000, 3, 500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const res = await pending;

    expect(call).toBe(3);
    expect(res.authed).toBe(false);
    expect(res.policy).toEqual({ allow: { "*": [] } });
    vi.useRealTimers();
  });

  it("warns once when it concedes the open fallback, so a silent downgrade is visible", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mint = vi.fn(() => Promise.reject(new Error("token service down")));

    const res = await resolveStartupAuth(mint, 100, 2, 1);

    expect(res.authed).toBe(false);
    expect(mint).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("resolveStartupAuth");
    warn.mockRestore();
  });
});

describe("initialTokenRefreshDelayMs", () => {
  it("schedules off the real expiry when the session came up authed (HAR-69/HAR-72)", () => {
    const now = Date.now();
    const delay = initialTokenRefreshDelayMs(
      { authed: true, expiresAtMs: now + 25 * 60 * 1000 },
      45 * 60 * 1000,
      1000,
    );

    expect(delay).toBe(5 * 60 * 1000);
  });

  it("falls back to retryMs when the session came up unauthed", () => {
    const delay = initialTokenRefreshDelayMs(
      { authed: false, expiresAtMs: undefined },
      45 * 60 * 1000,
      1000,
    );

    expect(delay).toBe(1000);
  });

  it("falls back to retryMs when authed is true but no expiry was captured", () => {
    const delay = initialTokenRefreshDelayMs(
      { authed: true, expiresAtMs: undefined },
      45 * 60 * 1000,
      1000,
    );

    expect(delay).toBe(1000);
  });
});

describe("resolveBootstrapNetworkPolicy", () => {
  const authedPolicy = { allow: { x: [] } } as SandboxNetworkPolicy;

  it("returns the policy when the mint came up authed", async () => {
    const policy = await resolveBootstrapNetworkPolicy(() =>
      Promise.resolve({ policy: authedPolicy, authed: true }),
    );
    expect(policy).toEqual(authedPolicy);
  });

  it("throws loudly instead of cloning a private repo unauthenticated", async () => {
    await expect(
      resolveBootstrapNetworkPolicy(() =>
        Promise.resolve({ policy: { allow: { "*": [] } }, authed: false }),
      ),
    ).rejects.toThrow(/GitHub auth could not be minted/);
  });
});

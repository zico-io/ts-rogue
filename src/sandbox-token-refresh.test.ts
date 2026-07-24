import type { SandboxNetworkPolicy } from "eve/sandbox";
import { describe, expect, it, vi } from "vitest";

import {
  buildBootstrapCommand,
  dependencyRevalidationKey,
  keepTokenFresh,
  MAX_SET_POLICY_FAILURES,
  resolveStartupNetworkPolicy,
  SYNC_MAIN_COMMAND,
} from "../agent/sandbox";

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
    const minted: SandboxNetworkPolicy[] = [
      { allow: { a: [] } } as SandboxNetworkPolicy,
      { allow: { b: [] } } as SandboxNetworkPolicy,
    ];
    let n = 0;

    keepTokenFresh(sandbox, () => Promise.resolve(minted[n++]), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(applied).toEqual([minted[0], minted[1]]);
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
        : Promise.resolve(good);
    };

    keepTokenFresh(sandbox, mintPolicy, 1000);
    await vi.advanceTimersByTimeAsync(1000); // mint rejects, reschedules, no apply
    await vi.advanceTimersByTimeAsync(1000); // mint resolves, policy applied

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
        : Promise.resolve(good);
    };

    keepTokenFresh(sandbox, mintPolicy, {
      refreshMs: 10000,
      retryMs: 1000,
      initialMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000); // first attempt fails -> retry cadence
    expect(applied).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000); // retry succeeds -> applies, slow cadence
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(1000); // still inside refreshMs, no new mint
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(9000); // reach refreshMs -> mint + apply again
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
        // First apply blips; refresh must not die on it.
        if (call === 1) return Promise.reject(new Error("transient blip"));
        applied.push(policy);
        return Promise.resolve();
      },
    };

    keepTokenFresh(sandbox, () => Promise.resolve(good), 1000);
    await vi.advanceTimersByTimeAsync(1000); // apply blips -> retry scheduled
    expect(applied).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000); // retry applies successfully
    expect(applied).toEqual([good]);
    await vi.advanceTimersByTimeAsync(1000); // and keeps refreshing afterward
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
      () => Promise.resolve({ allow: {} } as SandboxNetworkPolicy),
      1000,
    );
    // Advance well past the bounded retries; the chain must stop, not loop forever.
    await vi.advanceTimersByTimeAsync(1000 * (MAX_SET_POLICY_FAILURES + 5));

    expect(calls).toBe(MAX_SET_POLICY_FAILURES);
    vi.useRealTimers();
  });
});

describe("resolveStartupNetworkPolicy", () => {
  it("comes up authed when the token mint succeeds", async () => {
    const authedPolicy = { allow: { x: [] } } as SandboxNetworkPolicy;
    const res = await resolveStartupNetworkPolicy(
      () => Promise.resolve(authedPolicy),
      1000,
    );
    expect(res).toEqual({ policy: authedPolicy, authed: true });
  });

  it("falls back to an open, unauthenticated policy when the mint fails", async () => {
    const res = await resolveStartupNetworkPolicy(
      () => Promise.reject(new Error("token down")),
      1000,
    );
    expect(res.authed).toBe(false);
    expect(res.policy).toEqual({ allow: { "*": [] } });
  });

  it("falls back when the mint hangs past the timeout (no silent stall)", async () => {
    vi.useFakeTimers();
    const pending = resolveStartupNetworkPolicy(
      () => new Promise<SandboxNetworkPolicy>(() => {}),
      1000,
    );
    await vi.advanceTimersByTimeAsync(1000);
    const res = await pending;
    expect(res.authed).toBe(false);
    expect(res.policy).toEqual({ allow: { "*": [] } });
    vi.useRealTimers();
  });
});

describe("dependencyRevalidationKey", () => {
  it("hashes the lockfile into a stable deps: key that snapshots reuse", () => {
    const key = dependencyRevalidationKey();
    // Reused snapshot key: same lockfile -> same key, so commits that don't
    // change deps hit the cached node_modules instead of a cold install.
    expect(key).toBe(dependencyRevalidationKey());
    expect(key).toMatch(/^deps:[0-9a-f]{64}$/);
  });
});

describe("buildBootstrapCommand", () => {
  it("repoints apt at https before any apt-get call (plain HTTP egress is blocked in-sandbox)", () => {
    const command = buildBootstrapCommand();
    const httpsFixIndex = command.indexOf("https://archive.ubuntu.com");
    const firstAptGetIndex = command.indexOf("apt-get update");
    expect(httpsFixIndex).toBeGreaterThan(-1);
    expect(firstAptGetIndex).toBeGreaterThan(-1);
    expect(httpsFixIndex).toBeLessThan(firstAptGetIndex);
  });

  it("verifies chromium actually launches instead of trusting the install step", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain("playwright install --with-deps chromium");
    expect(command).toContain("chromium.launch()");
  });

  it("records the screenshot-tooling verdict on both the success and failure path", () => {
    const command = buildBootstrapCommand();
    expect(command).toContain('"available":true');
    expect(command).toContain('"available":false');
    expect(command).toContain(".eve/screenshot-tooling.json");
  });

  it("never lets a failed screenshot-tooling install fail the whole bootstrap", () => {
    // The chromium block is `(A && B && C) || fallback` - the closing paren
    // right before `||` is what makes the whole group always exit 0, however
    // A/B/C individually fare.
    const command = buildBootstrapCommand();
    expect(command).toMatch(/\)\s*\|\|\s*echo/);
  });
});

describe("SYNC_MAIN_COMMAND", () => {
  it("only force-resyncs main when HEAD is already on main", () => {
    expect(SYNC_MAIN_COMMAND).toContain('"$CURRENT_BRANCH" = "main"');
    expect(SYNC_MAIN_COMMAND).toContain("git checkout -B main FETCH_HEAD");
  });

  it("leaves a non-main branch in place instead of resyncing", () => {
    expect(SYNC_MAIN_COMMAND).toContain(
      "leaving it in place instead of resyncing",
    );
  });
});

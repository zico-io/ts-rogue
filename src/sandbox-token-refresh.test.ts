import type { SandboxNetworkPolicy } from "eve/sandbox";
import { describe, expect, it, vi } from "vitest";

import { keepTokenFresh, resolveStartupNetworkPolicy } from "../agent/sandbox";

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

  it("stops refreshing once the sandbox is torn down", async () => {
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
    await vi.advanceTimersByTimeAsync(5000);

    expect(calls).toBe(1);
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

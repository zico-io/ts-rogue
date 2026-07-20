import type { SandboxNetworkPolicy } from "eve/sandbox";
import { describe, expect, it, vi } from "vitest";

import { keepTokenFresh } from "../agent/sandbox";

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

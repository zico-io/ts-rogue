import { afterEach, describe, expect, it, vi } from "vitest";

import type { SandboxNetworkPolicy } from "eve/sandbox";

import { OPEN_NETWORK_POLICY, resolveStartupNetworkPolicy } from "./sandbox";

const SENTINEL_POLICY: SandboxNetworkPolicy = { allow: { "example.com": [] } };

const FAST = { timeoutMs: 100, gapMs: 1 } as const;

function flakyMint(failures: number): () => Promise<SandboxNetworkPolicy> {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls <= failures) throw new Error(`mint blip ${calls}`);
    return SENTINEL_POLICY;
  };
}

describe("resolveStartupNetworkPolicy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns and concedes the OPEN fallback when the mint fails every attempt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mint = vi.fn(async () => {
      throw new Error("token service down");
    });

    const result = await resolveStartupNetworkPolicy(
      mint,
      FAST.timeoutMs,
      2,
      FAST.gapMs,
    );

    expect(result).toEqual({ policy: OPEN_NETWORK_POLICY, authed: false });
    expect(mint).toHaveBeenCalledTimes(2);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "resolveStartupNetworkPolicy",
    );
  });

  it("rides out a transient blip and comes up authed within the widened budget", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await resolveStartupNetworkPolicy(
      flakyMint(3),
      FAST.timeoutMs,
      4,
      FAST.gapMs,
    );

    expect(result).toEqual({ policy: SENTINEL_POLICY, authed: true });
    expect(warn).not.toHaveBeenCalled();
  });
});

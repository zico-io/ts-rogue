import { describe, expect, it, vi } from "vitest";

vi.mock("eve/hooks", () => ({ defineHook: (def: unknown) => def }));

const FRESH_POLICY = { allow: { "github.com": [] } };
vi.mock("../agent/sandbox/sandbox", () => ({
  mintFreshPolicy: vi.fn(() => Promise.resolve(FRESH_POLICY)),
}));

const { mintFreshPolicy } = await import("../agent/sandbox/sandbox");
const events =
  // biome-ignore lint/suspicious/noExplicitAny: driving mocked hook handlers in a test
  (await import("../agent/hooks/prewarm-sandbox")).default.events as any;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("prewarm-sandbox hook", () => {
  it("kicks sandbox creation at turn start without awaiting it", () => {
    let settled = false;
    const getSandbox = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve({ setNetworkPolicy: () => Promise.resolve() });
          }, 20),
        ),
    );
    events["turn.started"]({}, { getSandbox });
    expect(getSandbox).toHaveBeenCalledTimes(1);
    // Fire-and-forget: the handler returned while creation was still running.
    expect(settled).toBe(false);
  });

  it("re-mints and re-installs the auth header once the sandbox resolves", async () => {
    // The durable half of token refresh: every turn re-installs a fresh
    // GitHub header, so push auth recovers even when keepTokenFresh's timer
    // chain died with a recycled process or an expired OIDC token.
    const setNetworkPolicy = vi.fn(() => Promise.resolve());
    events["turn.started"](
      {},
      { getSandbox: () => Promise.resolve({ setNetworkPolicy }) },
    );
    await flush();
    expect(mintFreshPolicy).toHaveBeenCalled();
    expect(setNetworkPolicy).toHaveBeenCalledWith(FRESH_POLICY);
  });

  it("swallows a rejected creation instead of failing the turn", async () => {
    events["turn.started"](
      {},
      { getSandbox: () => Promise.reject(new Error("backend down")) },
    );
    // Flush microtasks; an unhandled rejection here would fail the test run.
    await flush();
  });

  it("swallows a failed re-mint instead of failing the turn", async () => {
    vi.mocked(mintFreshPolicy).mockRejectedValueOnce(
      new Error("token service down"),
    );
    const setNetworkPolicy = vi.fn(() => Promise.resolve());
    events["turn.started"](
      {},
      { getSandbox: () => Promise.resolve({ setNetworkPolicy }) },
    );
    await flush();
    expect(setNetworkPolicy).not.toHaveBeenCalled();
  });

  it("swallows a failed setNetworkPolicy instead of failing the turn", async () => {
    events["turn.started"](
      {},
      {
        getSandbox: () =>
          Promise.resolve({
            setNetworkPolicy: () => Promise.reject(new Error("torn down")),
          }),
      },
    );
    await flush();
  });

  it("swallows a synchronous throw when no sandbox runtime exists", () => {
    const getSandbox = () => {
      throw new Error("eve sandbox runtime access is unavailable");
    };
    expect(() => events["turn.started"]({}, { getSandbox })).not.toThrow();
  });
});

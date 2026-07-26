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

// The root's interactive session carries no `parent`; a declared subagent
// (coder/reviewer/playtester) does. The hook re-mints fire-and-forget for the
// root and awaits it in-band for a subagent (task-mode durable step).
const rootCtx = (getSandbox: unknown) => ({
  getSandbox,
  session: { parent: undefined },
});
const subagentCtx = (getSandbox: unknown) => ({
  getSandbox,
  session: { parent: { sessionId: "root-session" } },
});

describe("prewarm-sandbox hook", () => {
  it("kicks sandbox creation at turn start without awaiting it (root)", () => {
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
    events["turn.started"]({}, rootCtx(getSandbox));
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
      rootCtx(() => Promise.resolve({ setNetworkPolicy })),
    );
    await flush();
    expect(mintFreshPolicy).toHaveBeenCalled();
    expect(setNetworkPolicy).toHaveBeenCalledWith(FRESH_POLICY);
  });

  it("awaits the re-mint in-band for a subagent so it lands before the step checkpoints", async () => {
    // A task-mode subagent's turn.started fires once and its background refresh
    // timer never ticks, so a detached re-mint could be frozen before it lands.
    // The handler must not resolve until the re-mint has been installed.
    let installed = false;
    const setNetworkPolicy = vi.fn(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            installed = true;
            resolve();
          }, 10),
        ),
    );
    await events["turn.started"](
      {},
      subagentCtx(() => Promise.resolve({ setNetworkPolicy })),
    );
    expect(installed).toBe(true);
    expect(setNetworkPolicy).toHaveBeenCalledWith(FRESH_POLICY);
  });

  it("swallows a rejected creation instead of failing the turn", async () => {
    events["turn.started"](
      {},
      rootCtx(() => Promise.reject(new Error("backend down"))),
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
      rootCtx(() => Promise.resolve({ setNetworkPolicy })),
    );
    await flush();
    expect(setNetworkPolicy).not.toHaveBeenCalled();
  });

  it("swallows a failed setNetworkPolicy instead of failing the turn (root and subagent)", async () => {
    const failing = () =>
      Promise.resolve({
        setNetworkPolicy: () => Promise.reject(new Error("torn down")),
      });
    events["turn.started"]({}, rootCtx(failing));
    // The awaited subagent path must also swallow, not reject the handler.
    await expect(
      events["turn.started"]({}, subagentCtx(failing)),
    ).resolves.toBeUndefined();
    await flush();
  });

  it("swallows a synchronous throw when no sandbox runtime exists", () => {
    const getSandbox = () => {
      throw new Error("eve sandbox runtime access is unavailable");
    };
    expect(() => events["turn.started"]({}, rootCtx(getSandbox))).not.toThrow();
  });
});

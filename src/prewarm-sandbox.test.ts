import type { HookContext, HookEvent } from "eve/hooks";
import { describe, expect, it, vi } from "vitest";

vi.mock("eve/hooks", () => ({ defineHook: (def: unknown) => def }));

const FRESH_POLICY = { allow: { "github.com": [] } };
vi.mock("../agent/sandbox/sandbox", () => ({
  mintFreshPolicy: vi.fn(() => Promise.resolve(FRESH_POLICY)),
}));

const { mintFreshPolicy } = await import("../agent/sandbox/sandbox");
const hook = (await import("../agent/hooks/prewarm-sandbox")).default;

const flush = () => new Promise((resolve) => setImmediate(resolve));

// The hook reads only `getSandbox()` and `session.parent`; the fakes answer
// with what it touches, not a whole `HookContext` or eve `SandboxSession`.
const hookCtx = (
  getSandbox: () => Promise<unknown>,
  parent?: { readonly sessionId: string },
): HookContext =>
  ({ getSandbox, session: { parent } }) as unknown as HookContext;

const rootCtx = (getSandbox: () => Promise<unknown>) => hookCtx(getSandbox);
const subagentCtx = (getSandbox: () => Promise<unknown>) =>
  hookCtx(getSandbox, { sessionId: "root-session" });

const turnStartedEvent = {} as unknown as HookEvent<"turn.started">;

const turnStarted = (ctx: HookContext): Promise<void> =>
  Promise.resolve(hook.events?.["turn.started"]?.(turnStartedEvent, ctx));

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
    turnStarted(rootCtx(getSandbox));
    expect(getSandbox).toHaveBeenCalledTimes(1);

    expect(settled).toBe(false);
  });

  it("re-mints and re-installs the auth header once the sandbox resolves", async () => {
    const setNetworkPolicy = vi.fn(() => Promise.resolve());
    turnStarted(rootCtx(() => Promise.resolve({ setNetworkPolicy })));
    await flush();
    expect(mintFreshPolicy).toHaveBeenCalled();
    expect(setNetworkPolicy).toHaveBeenCalledWith(FRESH_POLICY);
  });

  it("awaits the re-mint in-band for a subagent so it lands before the step checkpoints", async () => {
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
    await turnStarted(subagentCtx(() => Promise.resolve({ setNetworkPolicy })));
    expect(installed).toBe(true);
    expect(setNetworkPolicy).toHaveBeenCalledWith(FRESH_POLICY);
  });

  it("swallows a rejected creation instead of failing the turn", async () => {
    turnStarted(rootCtx(() => Promise.reject(new Error("backend down"))));

    await flush();
  });

  it("swallows a failed re-mint instead of failing the turn", async () => {
    vi.mocked(mintFreshPolicy).mockRejectedValueOnce(
      new Error("token service down"),
    );
    const setNetworkPolicy = vi.fn(() => Promise.resolve());
    turnStarted(rootCtx(() => Promise.resolve({ setNetworkPolicy })));
    await flush();
    expect(setNetworkPolicy).not.toHaveBeenCalled();
  });

  it("swallows a failed setNetworkPolicy instead of failing the turn (root and subagent)", async () => {
    const failing = () =>
      Promise.resolve({
        setNetworkPolicy: () => Promise.reject(new Error("torn down")),
      });
    turnStarted(rootCtx(failing));

    await expect(turnStarted(subagentCtx(failing))).resolves.toBeUndefined();
    await flush();
  });

  it("swallows a synchronous throw when no sandbox runtime exists", () => {
    const getSandbox = () => {
      throw new Error("eve sandbox runtime access is unavailable");
    };
    expect(() => turnStarted(rootCtx(getSandbox))).not.toThrow();
  });
});

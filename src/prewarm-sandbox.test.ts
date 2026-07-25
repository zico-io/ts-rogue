import { describe, expect, it, vi } from "vitest";

vi.mock("eve/hooks", () => ({ defineHook: (def: unknown) => def }));

const events =
  // biome-ignore lint/suspicious/noExplicitAny: driving mocked hook handlers in a test
  (await import("../agent/hooks/prewarm-sandbox")).default.events as any;

describe("prewarm-sandbox hook", () => {
  it("kicks sandbox creation at turn start without awaiting it", () => {
    let settled = false;
    const getSandbox = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve(null);
          }, 20),
        ),
    );
    events["turn.started"]({}, { getSandbox });
    expect(getSandbox).toHaveBeenCalledTimes(1);
    // Fire-and-forget: the handler returned while creation was still running.
    expect(settled).toBe(false);
  });

  it("swallows a rejected creation instead of failing the turn", async () => {
    events["turn.started"](
      {},
      { getSandbox: () => Promise.reject(new Error("backend down")) },
    );
    // Flush microtasks; an unhandled rejection here would fail the test run.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("swallows a synchronous throw when no sandbox runtime exists", () => {
    const getSandbox = () => {
      throw new Error("eve sandbox runtime access is unavailable");
    };
    expect(() => events["turn.started"]({}, { getSandbox })).not.toThrow();
  });
});

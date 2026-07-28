import { describe, expect, it, vi } from "vitest";

import { Webhook } from "./webhook";

const request = (body: string) =>
  new Request("https://example.test/eve/v1/hook", { method: "POST", body });

describe("Webhook.verify (verifier protocol)", () => {
  it("returns the raw body when the verifier accepts", async () => {
    await expect(
      new Webhook("testChannel", async () => true).verify(request("{}")),
    ).resolves.toBe("{}");
  });

  it("uses the verifier's returned string as the body", async () => {
    await expect(
      new Webhook("testChannel", async () => '{"rewritten":true}').verify(
        request("{}"),
      ),
    ).resolves.toBe('{"rewritten":true}');
  });

  it("throws when the verifier rejects", async () => {
    await expect(
      new Webhook("testChannel", async () => false).verify(request("{}")),
    ).rejects.toThrow("testChannel: inbound webhook verifier rejected");
  });

  it("throws with no verifier and no fallback, rather than skipping verification", async () => {
    await expect(
      new Webhook("testChannel", undefined).verify(request("{}")),
    ).rejects.toThrow("testChannel: no webhookVerifier configured.");
  });
});

describe("Webhook.verify (fallback)", () => {
  it("delegates to the fallback when no verifier is configured", async () => {
    const fallback = vi.fn(async (_req: Request, rawBody: string) => rawBody);

    await expect(
      new Webhook("testChannel", undefined, fallback).verify(request("{}")),
    ).resolves.toBe("{}");
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("propagates a fallback's rejection", async () => {
    await expect(
      new Webhook("testChannel", undefined, async () => {
        throw new Error("signature mismatch");
      }).verify(request("{}")),
    ).rejects.toThrow("signature mismatch");
  });

  it("skips the fallback entirely when a verifier is configured", async () => {
    const fallback = vi.fn(async () => "unreachable");

    await expect(
      new Webhook("testChannel", async () => true, fallback).verify(
        request("{}"),
      ),
    ).resolves.toBe("{}");
    expect(fallback).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

import { verifyWebhook } from "./webhook";

const request = (body: string) =>
  new Request("https://example.test/eve/v1/hook", { method: "POST", body });

describe("verifyWebhook (verifier protocol)", () => {
  it("returns the raw body when the verifier accepts", async () => {
    await expect(
      verifyWebhook({
        channel: "testChannel",
        request: request("{}"),
        verifier: async () => true,
      }),
    ).resolves.toBe("{}");
  });

  it("uses the verifier's returned string as the body", async () => {
    await expect(
      verifyWebhook({
        channel: "testChannel",
        request: request("{}"),
        verifier: async () => '{"rewritten":true}',
      }),
    ).resolves.toBe('{"rewritten":true}');
  });

  it("throws when the verifier rejects", async () => {
    await expect(
      verifyWebhook({
        channel: "testChannel",
        request: request("{}"),
        verifier: async () => false,
      }),
    ).rejects.toThrow("testChannel: inbound webhook verifier rejected");
  });

  it("throws with no verifier and no fallback, rather than skipping verification", async () => {
    await expect(
      verifyWebhook({
        channel: "testChannel",
        request: request("{}"),
        verifier: undefined,
      }),
    ).rejects.toThrow("testChannel: no webhookVerifier configured.");
  });
});

describe("verifyWebhook (fallback)", () => {
  it("delegates to the fallback when no verifier is configured", async () => {
    const fallback = vi.fn(async (_req: Request, rawBody: string) => rawBody);

    await expect(
      verifyWebhook({
        channel: "testChannel",
        fallback,
        request: request("{}"),
        verifier: undefined,
      }),
    ).resolves.toBe("{}");
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("propagates a fallback's rejection", async () => {
    await expect(
      verifyWebhook({
        channel: "testChannel",
        fallback: async () => {
          throw new Error("signature mismatch");
        },
        request: request("{}"),
        verifier: undefined,
      }),
    ).rejects.toThrow("signature mismatch");
  });

  it("skips the fallback entirely when a verifier is configured", async () => {
    const fallback = vi.fn(async () => "unreachable");

    await expect(
      verifyWebhook({
        channel: "testChannel",
        fallback,
        request: request("{}"),
        verifier: async () => true,
      }),
    ).resolves.toBe("{}");
    expect(fallback).not.toHaveBeenCalled();
  });
});

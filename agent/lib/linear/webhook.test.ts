import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("eve/channels/linear", () => ({
  signLinearWebhookBody: (body: string, secret: string) =>
    createHmac("sha256", secret).update(body).digest("hex"),
}));

const { verifyLinearWebhook } = await import("./webhook");

const sign = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("hex");

const linearRequest = (body: string, signature?: string) =>
  new Request("https://example.test/eve/v1/linear", {
    method: "POST",
    body,
    ...(signature === undefined
      ? {}
      : { headers: { "linear-signature": signature } }),
  });

const freshBody = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ webhookTimestamp: Date.now(), ...extra });

describe("verifyLinearWebhook (signature path)", () => {
  const verify = (body: string, signature?: string) =>
    verifyLinearWebhook(linearRequest(body, signature), {
      webhookSecret: "s3cret",
    });

  it("returns the raw body for a correctly signed, fresh request", async () => {
    const body = freshBody({ action: "created" });

    await expect(verify(body, sign(body, "s3cret"))).resolves.toBe(body);
  });

  it("ignores a mismatched signature", async () => {
    const body = freshBody();

    await expect(verify(body, sign(body, "wrong"))).resolves.toBeNull();
  });

  it("ignores a request with no signature header", async () => {
    await expect(verify(freshBody())).resolves.toBeNull();
  });

  it("ignores a replay outside the allowed clock skew", async () => {
    const body = JSON.stringify({ webhookTimestamp: Date.now() - 120_000 });

    await expect(verify(body, sign(body, "s3cret"))).resolves.toBeNull();
  });

  it("ignores a correctly signed body carrying no timestamp", async () => {
    const body = JSON.stringify({ action: "created" });

    await expect(verify(body, sign(body, "s3cret"))).resolves.toBeNull();
  });

  it("ignores the request when no secret is configured anywhere", async () => {
    vi.stubEnv("LINEAR_WEBHOOK_SECRET", "");
    try {
      const body = freshBody();
      await expect(
        verifyLinearWebhook(linearRequest(body, sign(body, "s3cret")), {}),
      ).resolves.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("verifyLinearWebhook (verifier path)", () => {
  it("bypasses signature and timestamp checks when a verifier accepts", async () => {
    const body = JSON.stringify({ no: "timestamp needed" });

    await expect(
      verifyLinearWebhook(linearRequest(body), {
        webhookVerifier: async () => true,
      }),
    ).resolves.toBe(body);
  });

  it("uses a verifier's returned string as the body", async () => {
    await expect(
      verifyLinearWebhook(linearRequest("{}"), {
        webhookVerifier: async () => '{"rewritten":true}',
      }),
    ).resolves.toBe('{"rewritten":true}');
  });

  it("ignores the request when the verifier rejects", async () => {
    await expect(
      verifyLinearWebhook(linearRequest("{}"), {
        webhookVerifier: async () => false,
      }),
    ).resolves.toBeNull();
  });
});

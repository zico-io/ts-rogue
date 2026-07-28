import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("eve/channels/linear", () => ({
  signLinearWebhookBody: (body: string, secret: string) =>
    createHmac("sha256", secret).update(body).digest("hex"),
}));

const { linearWebhook } = await import("./webhook");

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

describe("linearWebhook (signature path)", () => {
  it("returns the raw body for a correctly signed, fresh request", async () => {
    const body = freshBody({ action: "created" });

    await expect(
      linearWebhook({ webhookSecret: "s3cret" })(
        linearRequest(body, sign(body, "s3cret")),
      ),
    ).resolves.toBe(body);
  });

  it("rejects a mismatched signature", async () => {
    const body = freshBody();

    await expect(
      linearWebhook({ webhookSecret: "s3cret" })(
        linearRequest(body, sign(body, "wrong")),
      ),
    ).rejects.toThrow("signature mismatch");
  });

  it("rejects a request with no signature header", async () => {
    await expect(
      linearWebhook({ webhookSecret: "s3cret" })(linearRequest(freshBody())),
    ).rejects.toThrow("missing Linear-Signature");
  });

  it("rejects a replay outside the allowed clock skew", async () => {
    const body = JSON.stringify({ webhookTimestamp: Date.now() - 120_000 });

    await expect(
      linearWebhook({ webhookSecret: "s3cret" })(
        linearRequest(body, sign(body, "s3cret")),
      ),
    ).rejects.toThrow("timestamp outside allowed skew");
  });

  it("rejects a correctly signed body carrying no timestamp", async () => {
    const body = JSON.stringify({ action: "created" });

    await expect(
      linearWebhook({ webhookSecret: "s3cret" })(
        linearRequest(body, sign(body, "s3cret")),
      ),
    ).rejects.toThrow("missing webhookTimestamp");
  });

  it("rejects when no secret is configured anywhere", async () => {
    vi.stubEnv("LINEAR_WEBHOOK_SECRET", "");
    try {
      const body = freshBody();
      await expect(
        linearWebhook({})(linearRequest(body, sign(body, "s3cret"))),
      ).rejects.toThrow("missing webhook secret");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("linearWebhook (verifier path)", () => {
  it("bypasses signature and timestamp checks when a verifier accepts", async () => {
    const body = JSON.stringify({ no: "timestamp needed" });

    await expect(
      linearWebhook({ webhookVerifier: async () => true })(linearRequest(body)),
    ).resolves.toBe(body);
  });

  it("uses a verifier's returned string as the body", async () => {
    await expect(
      linearWebhook({
        webhookVerifier: async () => '{"rewritten":true}',
      })(linearRequest("{}")),
    ).resolves.toBe('{"rewritten":true}');
  });

  it("rejects when the verifier rejects", async () => {
    await expect(
      linearWebhook({ webhookVerifier: async () => false })(
        linearRequest("{}"),
      ),
    ).rejects.toThrow("linearChannel: inbound webhook verifier rejected");
  });
});

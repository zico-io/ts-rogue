import { timingSafeEqual } from "node:crypto";

import type {
  LinearChannelConfig,
  LinearWebhookSecret,
} from "eve/channels/linear";
import { signLinearWebhookBody } from "eve/channels/linear";

import { isPlainObject } from "../narrow";
import { Webhook } from "../webhook";

const LINEAR_WEBHOOK_MAX_SKEW_MS = 60_000;

async function resolveLinearWebhookSecret(
  secret: LinearWebhookSecret | undefined,
): Promise<string> {
  const resolved =
    typeof secret === "function"
      ? await secret()
      : (secret ?? process.env.LINEAR_WEBHOOK_SECRET);
  if (!resolved) {
    throw new Error(
      "linearChannel: missing webhook secret. Pass credentials.webhookSecret, set LINEAR_WEBHOOK_SECRET, or supply credentials.webhookVerifier.",
    );
  }
  return resolved;
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function verifyWebhookTimestamp(rawBody: string, maxSkewMs: number): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error("linearChannel: inbound request body is not valid JSON.");
  }
  const timestamp = isPlainObject(parsed) ? parsed.webhookTimestamp : undefined;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    throw new Error("linearChannel: inbound request missing webhookTimestamp.");
  }
  if (Math.abs(Date.now() - timestamp) > maxSkewMs) {
    throw new Error(
      "linearChannel: inbound request timestamp outside allowed skew.",
    );
  }
}

/**
 * Linear's adaptation: an HMAC signature over the raw body plus a
 * timestamp-skew check. The skew check only guards the signature path - a
 * configured `webhookVerifier` owns replay protection itself.
 */
export const linearWebhook = (
  credentials: LinearChannelConfig["credentials"],
): Webhook =>
  new Webhook(
    "linearChannel",
    credentials?.webhookVerifier,
    async (request, rawBody) => {
      const secret = await resolveLinearWebhookSecret(
        credentials?.webhookSecret,
      );
      const signature = request.headers.get("linear-signature") ?? "";
      if (!signature) {
        throw new Error(
          "linearChannel: inbound request missing Linear-Signature.",
        );
      }
      if (
        !constantTimeCompare(signLinearWebhookBody(rawBody, secret), signature)
      ) {
        throw new Error("linearChannel: inbound request signature mismatch.");
      }
      verifyWebhookTimestamp(rawBody, LINEAR_WEBHOOK_MAX_SKEW_MS);
      return rawBody;
    },
  );

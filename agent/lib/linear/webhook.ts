import { timingSafeEqual } from "node:crypto";

import type { LinearChannelConfig } from "eve/channels/linear";
import { signLinearWebhookBody } from "eve/channels/linear";

import { isPlainObject } from "../narrow";

const MAX_SKEW_MS = 60_000;

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

/** A fresh timestamp guards the signature path against replay. */
const isFresh = (rawBody: string): boolean => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const timestamp = isPlainObject(parsed) ? parsed.webhookTimestamp : undefined;
  return (
    typeof timestamp === "number" &&
    Number.isFinite(timestamp) &&
    Math.abs(Date.now() - timestamp) <= MAX_SKEW_MS
  );
};

/**
 * Verifies an inbound Linear webhook the way eve's own route does; `null` to ignore.
 * ponytail: eve's `verifyLinearRequest` does exactly this but is not exported.
 */
export const verifyLinearWebhook = async (
  request: Request,
  credentials: LinearChannelConfig["credentials"],
): Promise<string | null> => {
  const rawBody = await request.text();

  const verifier = credentials?.webhookVerifier;
  if (verifier !== undefined) {
    const result = await verifier(request, rawBody);
    if (!result) return null;
    return typeof result === "string" ? result : rawBody;
  }

  const secret =
    typeof credentials?.webhookSecret === "function"
      ? await credentials.webhookSecret()
      : (credentials?.webhookSecret ?? process.env.LINEAR_WEBHOOK_SECRET);
  const signature = request.headers.get("linear-signature");
  if (!secret || !signature) return null;
  return constantTimeEqual(signLinearWebhookBody(rawBody, secret), signature) &&
    isFresh(rawBody)
    ? rawBody
    : null;
};

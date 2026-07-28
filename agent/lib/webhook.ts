/**
 * Eve's `credentials.webhookVerifier` shape, structurally identical across its
 * channels: a falsy result rejects the request, a string replaces the raw body,
 * and any other truthy result accepts it as-is.
 */
export type WebhookVerifier = (request: Request, rawBody: string) => unknown;

/**
 * Inbound webhook verification shared by every channel. The verifier protocol
 * is the same everywhere; each channel supplies only its own `fallback` for
 * when no verifier is configured. Omitting `fallback` means an unverifiable
 * request is rejected rather than trusted.
 *
 * Returns the verified raw body, or throws when the request must be rejected.
 */
export const verifyWebhook = async (options: {
  readonly channel: string;
  /** Channel-specific verification. Returns the verified body or throws. */
  readonly fallback?: (
    request: Request,
    rawBody: string,
  ) => string | Promise<string>;
  readonly request: Request;
  readonly verifier: WebhookVerifier | undefined;
}): Promise<string> => {
  const { channel, fallback, request, verifier } = options;
  const rawBody = await request.text();
  if (verifier === undefined) {
    if (fallback === undefined) {
      throw new Error(`${channel}: no webhookVerifier configured.`);
    }
    return fallback(request, rawBody);
  }
  const result = await verifier(request, rawBody);
  if (!result) {
    throw new Error(
      `${channel}: inbound webhook verifier rejected the request.`,
    );
  }
  return typeof result === "string" ? result : rawBody;
};

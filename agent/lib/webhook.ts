/**
 * Eve's `credentials.webhookVerifier` shape, structurally identical across its
 * channels: a falsy result rejects the request, a string replaces the raw body,
 * and any other truthy result accepts it as-is.
 */
export type WebhookVerifier = (request: Request, rawBody: string) => unknown;

/**
 * Channel-specific verification, used only when no `webhookVerifier` is
 * configured. Returns the verified body or throws.
 */
export type WebhookFallback = (
  request: Request,
  rawBody: string,
) => string | Promise<string>;

/**
 * Inbound webhook verification shared by every channel. The verifier protocol
 * is the same everywhere; each channel supplies only its own `fallback` for
 * when no verifier is configured. Omitting `fallback` means an unverifiable
 * request is rejected rather than trusted.
 */
export class Webhook {
  constructor(
    private readonly channel: string,
    private readonly verifier: WebhookVerifier | undefined,
    private readonly fallback?: WebhookFallback,
  ) {}

  /** The verified raw body. Throws when the request must be rejected. */
  async verify(request: Request): Promise<string> {
    const rawBody = await request.text();
    if (this.verifier === undefined) {
      if (this.fallback === undefined) {
        throw new Error(`${this.channel}: no webhookVerifier configured.`);
      }
      return this.fallback(request, rawBody);
    }
    const result = await this.verifier(request, rawBody);
    if (!result) {
      throw new Error(
        `${this.channel}: inbound webhook verifier rejected the request.`,
      );
    }
    return typeof result === "string" ? result : rawBody;
  }
}

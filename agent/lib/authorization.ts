/**
 * Shared pieces of "ask a human to connect a service". Both channels need the
 * same display name and outcome wording; each renders its own layout, so this
 * deliberately returns parts rather than a finished message.
 */

const connectionDisplayName = (name: string): string =>
  name.replace(/[-_/]+/gu, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export const authorizationDisplayName = (data: {
  readonly authorization?: { readonly displayName?: string } | null;
  readonly name: string;
}): string =>
  data.authorization?.displayName ?? connectionDisplayName(data.name);

export const authorizationOutcomeLabel = (outcome: string): string =>
  outcome === "timed-out" ? "timed out" : outcome;

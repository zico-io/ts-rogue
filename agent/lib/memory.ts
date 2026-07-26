import { getTokenResponse } from "@vercel/connect";

/**
 * Vercel Connect connector backing Eve's runtime memory store (HAR-71/72).
 *
 * Turso has no Marketplace-native Connect integration (unlike GitHub/Linear),
 * so this wraps the "database-blue-cloud" Turso Cloud database's admin token
 * as a Customer Managed API Key connector - a human pasted the token into the
 * Vercel dashboard once; this code never sees or stores it beyond a single
 * mint call. It is otherwise requested exactly like the GitHub connector in
 * ./sandbox.ts's mintGitHubTokenPolicy.
 */
export const MEMORY_DATABASE_CONNECTOR = "turso/ts-rogue-eve-memory";

/**
 * The database-blue-cloud Marketplace integration also injects this env var
 * with the database's connection URL (e.g. `libsql://<db>.turso.io`). A
 * connection URL is a hostname, not a credential, so it is read directly
 * instead of being brokered through Connect.
 */
export const MEMORY_DATABASE_URL_ENV = "TURSO_DATABASE_URL";

export interface MemoryDatabaseCredential {
  /** The database's connection URL, e.g. `libsql://<db>.turso.io`. */
  url: string;

  /** Minted via Vercel Connect for this call only; never persisted. */
  authToken: string;

  /** The minted token's expiry, in epoch ms. */
  expiresAt: number;
}

/**
 * Mints the current admin credential for Eve's runtime memory store.
 *
 * Call this immediately before using it rather than caching the result:
 * `@vercel/connect` keeps its own in-process cache and refreshes ahead of
 * expiry, so repeated calls are cheap and always return a valid token.
 *
 * This deliberately never touches the sandbox. Eve's memory store (HAR-73)
 * and its `remember`/`recall`/`forget` tools (HAR-74) run as ordinary
 * authored code in the trusted app runtime, not inside the agent's sandbox
 * shell, so there is no sandbox network policy to broker credentials
 * through - unlike GitHub, whose token authenticates `git`/`gh` commands the
 * agent runs directly inside its own sandbox (see ./sandbox.ts).
 */
export async function mintMemoryDatabaseCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MemoryDatabaseCredential> {
  const url = env[MEMORY_DATABASE_URL_ENV];
  if (!url) {
    throw new Error(
      `${MEMORY_DATABASE_URL_ENV} is not set - attach the database-blue-cloud ` +
        "Turso Cloud Marketplace integration to this Vercel project.",
    );
  }

  const response = await getTokenResponse(MEMORY_DATABASE_CONNECTOR, {
    subject: { type: "app" },
  });

  return { url, authToken: response.token, expiresAt: response.expiresAt };
}

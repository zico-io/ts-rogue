import { getTokenResponse } from "@vercel/connect";

/** Vercel Connect connector backing Eve's runtime memory store (HAR-71/72). */
export const MEMORY_DATABASE_CONNECTOR = "turso/ts-rogue-eve-memory";

/** Injected by the Turso Marketplace integration; a hostname, not a credential. */
export const MEMORY_DATABASE_URL_ENV = "TURSO_DATABASE_URL";

export interface MemoryDatabaseCredential {
  /** The database's connection URL, e.g. `libsql://<db>.turso.io`. */
  url: string;

  /** Minted via Vercel Connect for this call only; never persisted. */
  authToken: string;

  /** The minted token's expiry, in epoch ms. */
  expiresAt: number;
}

/** Mints the memory store's admin credential; call per use rather than caching. */
export async function mintMemoryDatabaseCredential(
  env: Readonly<Record<string, string | undefined>> = process.env,
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

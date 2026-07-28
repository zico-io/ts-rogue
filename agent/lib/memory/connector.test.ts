import { getTokenResponse } from "@vercel/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/connect", () => ({ getTokenResponse: vi.fn() }));

import {
  MEMORY_DATABASE_CONNECTOR,
  MEMORY_DATABASE_URL_ENV,
  mintMemoryDatabaseCredential,
} from "./connector";

describe("mintMemoryDatabaseCredential", () => {
  afterEach(() => vi.mocked(getTokenResponse).mockReset());

  it("throws a clear error when the database URL env var is unset", async () => {
    await expect(mintMemoryDatabaseCredential({})).rejects.toThrow(
      MEMORY_DATABASE_URL_ENV,
    );
    expect(getTokenResponse).not.toHaveBeenCalled();
  });

  it("pairs the env-provided URL with a freshly minted Connect token", async () => {
    vi.mocked(getTokenResponse).mockResolvedValueOnce({
      token: "minted-token",
      expiresAt: 1_234,
      connector: {
        id: "conn_1",
        uid: MEMORY_DATABASE_CONNECTOR,
        type: "apikey",
      },
    });

    const credential = await mintMemoryDatabaseCredential({
      [MEMORY_DATABASE_URL_ENV]: "libsql://ts-rogue-eve-memory.turso.io",
    });

    expect(credential).toEqual({
      url: "libsql://ts-rogue-eve-memory.turso.io",
      authToken: "minted-token",
      expiresAt: 1_234,
    });
    expect(getTokenResponse).toHaveBeenCalledWith(MEMORY_DATABASE_CONNECTOR, {
      subject: { type: "app" },
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("../../../../lib/harness/authz", () => ({
  isHarnessSuperadmin: vi.fn(() => false),
}));

describe("GET /api/harness/sessions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 and never calls out to Vercel while unauthorized", async () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const response = await GET(
        new Request("https://example.test/api/harness/sessions"),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

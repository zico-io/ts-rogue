import { describe, expect, it, vi } from "vitest";

vi.mock("eve/tools", () => ({
  defineTool: (def: unknown) => def,
}));

import webSearchTool, {
  buildExaSearchRequestBody,
  executeExaSearch,
  normalizeExaSearchResponse,
} from "../agent/tools/web_search";

describe("web_search tool (Exa)", () => {
  it("builds the Exa request body with defaults", () => {
    expect(
      buildExaSearchRequestBody({ query: "seeded RNG in roguelikes" }),
    ).toEqual({
      query: "seeded RNG in roguelikes",
      numResults: 5,
      contents: { highlights: true },
    });
  });

  it("builds the Exa request body with optional domain filters and numResults", () => {
    expect(
      buildExaSearchRequestBody({
        query: "rot.js field of view",
        numResults: 10,
        includeDomains: ["github.com"],
        excludeDomains: ["pinterest.com"],
      }),
    ).toEqual({
      query: "rot.js field of view",
      numResults: 10,
      includeDomains: ["github.com"],
      excludeDomains: ["pinterest.com"],
      contents: { highlights: true },
    });
  });

  it("normalizes Exa's response to the smaller result shape", () => {
    expect(
      normalizeExaSearchResponse({
        requestId: "req-1",
        results: [
          {
            title: "A page",
            url: "https://example.com/a",
            publishedDate: "2024-01-15",
            highlights: ["A key excerpt."],
          },
          {
            title: null,
            url: "https://example.com/b",
            text: "Fallback body text.",
          },
        ],
      }),
    ).toEqual({
      searchId: "req-1",
      results: [
        {
          title: "A page",
          url: "https://example.com/a",
          publishedDate: "2024-01-15",
          excerpt: "A key excerpt.",
        },
        {
          title: "https://example.com/b",
          url: "https://example.com/b",
          publishedDate: null,
          excerpt: "Fallback body text.",
        },
      ],
    });
  });

  it("calls the Exa search endpoint with the api key header and maps the response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        requestId: "req-2",
        results: [
          { title: "Result", url: "https://example.com", highlights: ["x"] },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await executeExaSearch(
      { query: "ts-rogue architecture" },
      "test-key",
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "test-key" }),
      }),
    );
    expect(result).toEqual({
      searchId: "req-2",
      results: [
        {
          title: "Result",
          url: "https://example.com",
          publishedDate: null,
          excerpt: "x",
        },
      ],
    });
  });

  it("throws a descriptive error when Exa responds with a non-ok status", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "invalid api key",
    })) as unknown as typeof fetch;

    await expect(
      executeExaSearch({ query: "anything" }, "bad-key", fetchImpl),
    ).rejects.toThrow(/Exa search failed: 401 Unauthorized - invalid api key/);
  });

  it("wires the default export's execute to require EXA_API_KEY", async () => {
    const previous = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: mocked defineTool passes the raw definition through
      const tool = webSearchTool as any;
      await expect(tool.execute({ query: "anything" })).rejects.toThrow(
        "EXA_API_KEY is not configured",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.EXA_API_KEY;
      } else {
        process.env.EXA_API_KEY = previous;
      }
    }
  });
});

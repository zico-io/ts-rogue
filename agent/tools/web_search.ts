import { defineTool } from "eve/tools";
import { z } from "zod";

// Overrides the framework's provider-managed `web_search` (see
// eve/tools/defaults) with an Exa-backed implementation. The default tool has
// no local executor and no useful input schema - the model provider picks
// whichever search backend it has wired up (Parallel, Google, etc). Exa gives
// consistent, high-quality neural search results regardless of the model
// provider in use, so we author our own schema and executor here instead of
// spreading the default.
const EXA_SEARCH_URL = "https://api.exa.ai/search";

export const webSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(2000)
    .describe("Natural-language search query or keywords."),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Number of results to return. Defaults to 5, max 25."),
  includeDomains: z
    .array(z.string())
    .max(50)
    .optional()
    .describe('Restrict results to these domains (e.g. "github.com").'),
  excludeDomains: z
    .array(z.string())
    .max(50)
    .optional()
    .describe("Exclude results from these domains."),
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

export interface WebSearchResult {
  title: string;
  url: string;
  publishedDate: string | null;
  excerpt: string;
}

export interface WebSearchOutput {
  searchId: string;
  results: WebSearchResult[];
}

// Minimal local alias - avoids pulling in eve's internal JsonObject type just
// for this file's request-body shape.
type JsonObject = Record<string, unknown>;

interface ExaSearchResult {
  title: string | null;
  url: string;
  publishedDate?: string | null;
  highlights?: string[];
  text?: string;
}

interface ExaSearchResponse {
  requestId: string;
  results: ExaSearchResult[];
}

/** Builds the Exa `/search` request body from the tool's input. Pure and
 * exported so request shaping is testable without a network call. */
export function buildExaSearchRequestBody(input: WebSearchInput): JsonObject {
  return {
    query: input.query,
    numResults: input.numResults ?? 5,
    ...(input.includeDomains ? { includeDomains: input.includeDomains } : {}),
    ...(input.excludeDomains ? { excludeDomains: input.excludeDomains } : {}),
    contents: { highlights: true },
  };
}

/** Projects Exa's response onto the smaller shape the model needs. Pure and
 * exported so response mapping is testable without a network call. */
export function normalizeExaSearchResponse(
  response: ExaSearchResponse,
): WebSearchOutput {
  return {
    searchId: response.requestId,
    results: response.results.map((result) => ({
      title: result.title ?? result.url,
      url: result.url,
      publishedDate: result.publishedDate ?? null,
      excerpt: result.highlights?.[0] ?? result.text ?? "",
    })),
  };
}

/** Calls Exa's `/search` endpoint and normalizes the response. `fetchImpl` is
 * injectable so tests can stub the network call. */
export async function executeExaSearch(
  input: WebSearchInput,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WebSearchOutput> {
  const response = await fetchImpl(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(buildExaSearchRequestBody(input)),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Exa search failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
    );
  }
  const json = (await response.json()) as ExaSearchResponse;
  return normalizeExaSearchResponse(json);
}

export default defineTool({
  description:
    "Search the web using Exa's neural search API to find current, real-time information. Use this for up-to-date facts, recent events, or topics that may have changed since the knowledge cutoff.",
  inputSchema: webSearchInputSchema,
  async execute(input) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      throw new Error("EXA_API_KEY is not configured; cannot run web_search.");
    }
    return executeExaSearch(input, apiKey);
  },
});

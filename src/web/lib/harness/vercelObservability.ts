import { resolveVercelApiEnv } from "./vercelEnv";

/**
 * Thin wrapper around `POST /v2/observability/query` (the
 * `createObservabilityQuery` operation `agent/connections/vercel-api.ts`
 * allows). Kept separate from the eve OpenAPI connection because that
 * connection is compiled into the agent's tool-calling surface, not
 * importable from `src/web`'s Next.js route handlers - this issues the same
 * HTTP call directly with the same server-only `VERCEL_TOKEN`.
 */
export interface ObservabilityQueryInput {
  metric: string;
  aggregation?: string;
  groupBy?: string[];
  filter?: string;
  startTime: string;
  endTime: string;
  limit?: number;
}

export type ObservabilityQueryOutcome =
  | { ok: true; raw: unknown }
  | { ok: false; reason: "observability_plus_required" | "upstream_error" };

export async function queryObservability(
  input: ObservabilityQueryInput,
  env = resolveVercelApiEnv(),
): Promise<ObservabilityQueryOutcome> {
  if (!env) return { ok: false, reason: "upstream_error" };

  let response: Response;
  try {
    response = await fetch("https://api.vercel.com/v2/observability/query", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        metric: input.metric,
        scope: {
          type: "project",
          ownerId: env.teamId,
          projectIds: [env.projectId],
        },
        aggregation: input.aggregation,
        groupBy: input.groupBy,
        filter: input.filter,
        startTime: input.startTime,
        endTime: input.endTime,
        limit: input.limit,
      }),
    });
  } catch {
    return { ok: false, reason: "upstream_error" };
  }

  if (response.status === 402) {
    return { ok: false, reason: "observability_plus_required" };
  }
  if (!response.ok) {
    return { ok: false, reason: "upstream_error" };
  }

  try {
    return { ok: true, raw: await response.json() };
  } catch {
    return { ok: false, reason: "upstream_error" };
  }
}

/** One row of a normalized observability query response. */
export interface ObservabilityRow {
  tags: Record<string, string>;
  value: number;
}

/**
 * The documented response schema for this endpoint is an opaque `object`
 * (verified against the live OpenAPI spec: no fields are specified), and
 * this workspace's Vercel team lacks Observability Plus so no real response
 * has been inspected yet (see `eveTags.ts`). This assumes the single most
 * likely shape - a top-level `data` array of `{ tags, value }` rows - rather
 * than guessing at every wrapper/field-name variant a query engine might
 * plausibly use. Re-verify against a live response once Observability Plus
 * is enabled, and adjust this function (not its callers) if the real shape
 * differs.
 */
export function normalizeObservabilityRows(raw: unknown): ObservabilityRow[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>).data;
  if (!Array.isArray(list)) return [];

  const rows: ObservabilityRow[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const tagsSource = record.tags;
    if (!tagsSource || typeof tagsSource !== "object") continue;

    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      tagsSource as Record<string, unknown>,
    )) {
      if (typeof value === "string") tags[key] = value;
    }

    const value = typeof record.value === "number" ? record.value : 0;
    rows.push({ tags, value });
  }
  return rows;
}

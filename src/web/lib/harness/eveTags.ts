/**
 * The Vercel Workflow run tags eve writes on every session, turn, and
 * subagent run. See
 * `node_modules/eve/docs/guides/instrumentation.md#workflow-run-tags`.
 *
 * The exact query dimension paths for reading these tags back through
 * `POST /v2/observability/query` are unverified against live tagged data:
 * this workspace's Vercel team does not currently have Observability Plus,
 * so `createObservabilityQuery` returns 402 for every metric regardless of
 * shape (confirmed live against the real API on 2026-07-26). Re-check the
 * `EVE_TAG` values below once Observability Plus is enabled and a real
 * response is available to inspect.
 */
export const EVE_TAG = {
  type: "$eve.type",
  parent: "$eve.parent",
  root: "$eve.root",
  subagent: "$eve.subagent",
  trigger: "$eve.trigger",
  title: "$eve.title",
  model: "$eve.model",
  inputTokens: "$eve.input_tokens",
  outputTokens: "$eve.output_tokens",
  cacheReadTokens: "$eve.cache_read_tokens",
  toolCount: "$eve.tool_count",
} as const;

/** `groupBy`/`filter` dimension path for a tag, quoted per the connection's
 * documented nested-ref syntax (dimension names containing `$`, `.`, or `'`
 * must be single-quoted). */
export function tagDimension(tag: string): string {
  return `tags/'${tag.replaceAll("'", "''")}'`;
}

export const WORKFLOW_RUN_METRIC = "vercel.workflow_operation.runs";

export const WORKFLOW_COMPLETION_METRIC = {
  completed: "vercel.workflow_operation.run_completed",
  failed: "vercel.workflow_operation.run_failed",
  cancelled: "vercel.workflow_operation.run_cancelled",
} as const;

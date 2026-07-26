import {
  EVE_TAG,
  tagDimension,
  WORKFLOW_COMPLETION_METRIC,
  WORKFLOW_RUN_METRIC,
} from "./eveTags";
import { buildSessionTree, summarizeRootSessions } from "./grouping";
import {
  mapRowsToRunRecords,
  type RunRecordCompletionSets,
} from "./runRecords";
import type {
  HarnessRunNode,
  HarnessSessionSummary,
  HarnessUnavailableReason,
} from "./types";
import {
  normalizeObservabilityRows,
  type ObservabilityRow,
  queryObservability,
} from "./vercelObservability";

const RUN_GROUP_BY = [
  tagDimension(EVE_TAG.root),
  tagDimension(EVE_TAG.parent),
  tagDimension(EVE_TAG.type),
  tagDimension(EVE_TAG.subagent),
  tagDimension(EVE_TAG.trigger),
  tagDimension(EVE_TAG.title),
  tagDimension(EVE_TAG.model),
  tagDimension(EVE_TAG.inputTokens),
  tagDimension(EVE_TAG.outputTokens),
  tagDimension(EVE_TAG.cacheReadTokens),
  tagDimension(EVE_TAG.toolCount),
];

const COMPLETION_GROUP_BY = [
  tagDimension(EVE_TAG.root),
  tagDimension(EVE_TAG.subagent),
];

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface TimeWindow {
  startTime: string;
  endTime: string;
}

export function defaultWindow(now = new Date()): TimeWindow {
  return {
    startTime: new Date(now.getTime() - DEFAULT_WINDOW_MS).toISOString(),
    endTime: now.toISOString(),
  };
}

export type HarnessSessionsResult =
  | { ok: true; sessions: HarnessSessionSummary[] }
  | { ok: false; reason: HarnessUnavailableReason };

export type HarnessSessionTreeResult =
  | { ok: true; session: HarnessRunNode }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: HarnessUnavailableReason };

async function fetchCompletionRows(
  metric: string,
  window: TimeWindow,
  filter?: string,
): Promise<
  | { ok: true; rows: ObservabilityRow[] }
  | { ok: false; reason: HarnessUnavailableReason }
> {
  const outcome = await queryObservability({
    metric,
    aggregation: "sum",
    groupBy: COMPLETION_GROUP_BY,
    filter,
    startTime: window.startTime,
    endTime: window.endTime,
  });
  if (!outcome.ok) return outcome;
  return { ok: true, rows: normalizeObservabilityRows(outcome.raw) };
}

function completionKeysOf(rows: ObservabilityRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const rootId = row.tags[EVE_TAG.root];
    if (!rootId) continue;
    keys.add(`${rootId}:${row.tags[EVE_TAG.subagent] ?? ""}`);
  }
  return keys;
}

async function fetchCompletionSets(
  window: TimeWindow,
  filter?: string,
): Promise<RunRecordCompletionSets> {
  const [completed, failed, cancelled] = await Promise.all([
    fetchCompletionRows(WORKFLOW_COMPLETION_METRIC.completed, window, filter),
    fetchCompletionRows(WORKFLOW_COMPLETION_METRIC.failed, window, filter),
    fetchCompletionRows(WORKFLOW_COMPLETION_METRIC.cancelled, window, filter),
  ]);
  return {
    completed: completed.ok ? completionKeysOf(completed.rows) : undefined,
    failed: failed.ok ? completionKeysOf(failed.rows) : undefined,
    cancelled: cancelled.ok ? completionKeysOf(cancelled.rows) : undefined,
  };
}

/** Powers `GET /api/harness/sessions`: recent root sessions with totals. */
export async function listRecentRootSessions(
  window: TimeWindow = defaultWindow(),
): Promise<HarnessSessionsResult> {
  const runsOutcome = await queryObservability({
    metric: WORKFLOW_RUN_METRIC,
    aggregation: "sum",
    groupBy: RUN_GROUP_BY,
    startTime: window.startTime,
    endTime: window.endTime,
    limit: 100,
  });
  if (!runsOutcome.ok) return { ok: false, reason: runsOutcome.reason };

  const rows = normalizeObservabilityRows(runsOutcome.raw);
  const completion = await fetchCompletionSets(window);
  const records = mapRowsToRunRecords(rows, completion);
  return { ok: true, sessions: summarizeRootSessions(records) };
}

/** Powers `GET /api/harness/sessions/[id]`: one session's subagent tree. */
export async function getSessionTree(
  id: string,
  window: TimeWindow = defaultWindow(),
): Promise<HarnessSessionTreeResult> {
  const filter = `${tagDimension(EVE_TAG.root)} eq '${id.replaceAll("'", "''")}'`;

  const runsOutcome = await queryObservability({
    metric: WORKFLOW_RUN_METRIC,
    aggregation: "sum",
    groupBy: RUN_GROUP_BY,
    filter,
    startTime: window.startTime,
    endTime: window.endTime,
  });
  if (!runsOutcome.ok) return { ok: false, reason: runsOutcome.reason };

  const rows = normalizeObservabilityRows(runsOutcome.raw);
  if (rows.length === 0) return { ok: false, reason: "not_found" };

  const completion = await fetchCompletionSets(window, filter);
  const records = mapRowsToRunRecords(rows, completion);
  const session = buildSessionTree(id, records);
  if (!session) return { ok: false, reason: "not_found" };
  return { ok: true, session };
}

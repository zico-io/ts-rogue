import { EVE_TAG } from "./eveTags";
import type {
  HarnessRunRecord,
  HarnessRunStatus,
  HarnessRunType,
} from "./types";
import type { ObservabilityRow } from "./vercelObservability";

function readTag(row: ObservabilityRow, tag: string): string | null {
  const value = row.tags[tag];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumericTag(row: ObservabilityRow, tag: string): number {
  const value = readTag(row, tag);
  if (value === null) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readRunType(row: ObservabilityRow): HarnessRunType {
  const value = readTag(row, EVE_TAG.type);
  return value === "turn" || value === "subagent" ? value : "session";
}

export interface RunRecordCompletionSets {
  /** Keys are `${rootId}:${subagent ?? ""}`, matching one aggregate bucket. */
  completed?: Set<string>;
  failed?: Set<string>;
  cancelled?: Set<string>;
}

function completionKey(rootId: string, subagent: string | null): string {
  return `${rootId}:${subagent ?? ""}`;
}

function readStatus(
  key: string,
  { completed, failed, cancelled }: RunRecordCompletionSets,
): HarnessRunStatus {
  if (failed?.has(key)) return "failed";
  if (cancelled?.has(key)) return "cancelled";
  if (completed?.has(key)) return "completed";
  return "running";
}

export function mapRowsToRunRecords(
  rows: ObservabilityRow[],
  completion: RunRecordCompletionSets = {},
): HarnessRunRecord[] {
  return rows.map((row) => {
    const subagent = readTag(row, EVE_TAG.subagent);
    const rootId = readTag(row, EVE_TAG.root) ?? "";
    return {
      rootId,
      parentId: readTag(row, EVE_TAG.parent),
      type: readRunType(row),
      subagent,
      trigger: readTag(row, EVE_TAG.trigger),
      title: readTag(row, EVE_TAG.title),
      model: readTag(row, EVE_TAG.model),
      inputTokens: readNumericTag(row, EVE_TAG.inputTokens),
      outputTokens: readNumericTag(row, EVE_TAG.outputTokens),
      cacheReadTokens: readNumericTag(row, EVE_TAG.cacheReadTokens),
      toolCount: readNumericTag(row, EVE_TAG.toolCount),
      status: readStatus(completionKey(rootId, subagent), completion),
    };
  });
}

import type {
  HarnessRunNode,
  HarnessRunRecord,
  HarnessRunStatus,
  HarnessSessionSummary,
} from "./types";

interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  toolCount: number;
}

function sumTokens(records: HarnessRunRecord[]): TokenTotals {
  const totals: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    toolCount: 0,
  };
  for (const record of records) {
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.cacheReadTokens += record.cacheReadTokens;
    totals.toolCount += record.toolCount;
  }
  return totals;
}

function deriveStatus(records: HarnessRunRecord[]): HarnessRunStatus {
  if (records.length === 0) return "unknown";
  if (records.some((record) => record.status === "failed")) return "failed";
  if (records.some((record) => record.status === "cancelled"))
    return "cancelled";
  if (records.every((record) => record.status === "completed"))
    return "completed";
  if (records.some((record) => record.status === "running")) return "running";
  return "unknown";
}

/** Groups a flat run list by `rootId` (`$eve.root`) into session summaries. */
export function summarizeRootSessions(
  records: HarnessRunRecord[],
): HarnessSessionSummary[] {
  const byRoot = new Map<string, HarnessRunRecord[]>();
  for (const record of records) {
    if (!record.rootId) continue;
    const bucket = byRoot.get(record.rootId);
    if (bucket) bucket.push(record);
    else byRoot.set(record.rootId, [record]);
  }

  const summaries: HarnessSessionSummary[] = [];
  for (const [rootId, group] of byRoot) {
    const rootRecord =
      group.find(
        (record) => record.type === "session" && record.parentId === null,
      ) ?? group[0];
    const totals = sumTokens(group);

    summaries.push({
      id: rootId,
      title: rootRecord.title,
      trigger: rootRecord.trigger,
      status: deriveStatus(group),
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
    });
  }
  return summaries;
}

/**
 * Builds a session's subagent tree: the root session (its own turns
 * aggregated) with one child per distinct subagent role it ran, each
 * aggregating that role's turns. Returns null when `rootId` has no matching
 * records at all.
 */
export function buildSessionTree(
  rootId: string,
  records: HarnessRunRecord[],
): HarnessRunNode | null {
  const own = records.filter((record) => record.rootId === rootId);
  if (own.length === 0) return null;

  const ownTurns = own.filter((record) => record.subagent === null);
  const bySubagent = new Map<string, HarnessRunRecord[]>();
  for (const record of own) {
    if (!record.subagent) continue;
    const bucket = bySubagent.get(record.subagent);
    if (bucket) bucket.push(record);
    else bySubagent.set(record.subagent, [record]);
  }

  const rootTotals = sumTokens(ownTurns.length > 0 ? ownTurns : own);

  const children: HarnessRunNode[] = [...bySubagent.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subagent, group]) => {
      const totals = sumTokens(group);
      return {
        id: `${rootId}:${subagent}`,
        type: "subagent",
        subagent,
        model: group.find((record) => record.model)?.model ?? null,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheReadTokens: totals.cacheReadTokens,
        toolCount: totals.toolCount,
        status: deriveStatus(group),
        children: [],
      };
    });

  return {
    id: rootId,
    type: "session",
    subagent: null,
    model: ownTurns.find((record) => record.model)?.model ?? null,
    inputTokens: rootTotals.inputTokens,
    outputTokens: rootTotals.outputTokens,
    cacheReadTokens: rootTotals.cacheReadTokens,
    toolCount: rootTotals.toolCount,
    status: deriveStatus(own),
    children,
  };
}

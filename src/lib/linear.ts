import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { getToken } from "@vercel/connect";

const LINEAR_API = "https://api.linear.app/graphql";

const LINEAR_CONNECTOR = "linear/ts-rogue-eve";

const TEAM_QUERY = `query($key:String!){teams(filter:{key:{eq:$key}}){nodes{id labels{nodes{id name}}}}}`;
const ISSUE_MUTATION = `mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{identifier url}}}`;

export interface IssueContext {
  seed: number;
  scene: string;

  state: unknown;

  logTail: readonly string[];

  keySequence?: string;

  frame?: string;
  commit?: string;
  node?: string;

  terminal?: string;
  debugJournal?: readonly unknown[];
  incident?: {
    category: string;
    message: string;
    stack?: string;
    triggeringEvent?: string;
    fingerprint: string;
    journal: readonly unknown[];
  };
}

function fence(body: string, lang = ""): string {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

function details(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

export function buildIssueBody(ctx: IssueContext): string {
  const repro = ctx.keySequence?.trim()
    ? `Reproduce: \`pnpm game:dev --seed=${ctx.seed} --fresh\`, then the key sequence below.`
    : `Reproduce: \`pnpm game:dev --seed=${ctx.seed} --fresh\`.`;

  const meta = [
    `- Scene: \`${ctx.scene}\``,
    `- Seed: \`${ctx.seed}\``,
    ctx.commit ? `- Commit: \`${ctx.commit}\`` : "",
    ctx.node ? `- Node: \`${ctx.node}\`` : "",
    ctx.terminal ? `- Terminal: \`${ctx.terminal}\`` : "",
  ].filter(Boolean);

  const sections = ["## Repro", repro, "", "## Environment", ...meta];

  if (ctx.incident) {
    sections.push(
      "",
      "## Incident",
      `- Category: \`${ctx.incident.category}\``,
      `- Message: ${ctx.incident.message}`,
      `- Fingerprint: \`${ctx.incident.fingerprint}\``,
      ctx.incident.triggeringEvent
        ? `- Triggering event: \`${ctx.incident.triggeringEvent}\``
        : "",
    );
    if (ctx.incident.stack) {
      sections.push("", "### Stack", fence(ctx.incident.stack));
    }
    if (ctx.incident.journal.length > 0) {
      sections.push(
        "",
        "### Debug journal",
        details(
          "Recent entries",
          fence(JSON.stringify(ctx.incident.journal, null, 2), "json"),
        ),
      );
    }
  }
  if (!ctx.incident && ctx.debugJournal?.length) {
    sections.push(
      "",
      "## Debug journal",
      details(
        "Recent entries",
        fence(JSON.stringify(ctx.debugJournal, null, 2), "json"),
      ),
    );
  }

  if (ctx.keySequence?.trim()) {
    sections.push("", "## Key sequence", fence(ctx.keySequence.trim()));
  }
  if (ctx.frame?.trim()) {
    sections.push(
      "",
      "## Screen (captured from play session)",
      fence(ctx.frame.replace(/\s+$/, "")),
    );
  }
  if (ctx.logTail.length > 0) {
    sections.push("", "## Message log", fence(ctx.logTail.join("\n")));
  }
  sections.push(
    "",
    "## Game state",
    details(
      "GameState JSON",
      fence(JSON.stringify(ctx.state, null, 2), "json"),
    ),
    "",
    "---",
    "_Filed from the ts-rogue dev console._",
  );

  return sections.join("\n");
}

export interface CreateIssueInput {
  title: string;
  body: string;

  label?: string;
}

export interface LinearConfig {
  accessToken: string;
  teamKey: string;
}

export async function resolveLinearConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<LinearConfig | null> {
  try {
    const accessToken = await getToken(LINEAR_CONNECTOR, {
      subject: { type: "app" },
    });
    return { accessToken, teamKey: env.LINEAR_TEAM_KEY ?? "ROG" };
  } catch {
    return null;
  }
}

export function issueCreateVariables(
  teamId: string,
  input: CreateIssueInput,
  labelIds: string[],
): { input: Record<string, unknown> } {
  return {
    input: {
      teamId,
      title: input.title,
      description: input.body,
      ...(labelIds.length > 0 ? { labelIds } : {}),
    },
  };
}

async function graphql<T>(
  config: LinearConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (!res.ok || json.errors?.length) {
    throw new Error(
      json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`,
    );
  }
  if (!json.data) throw new Error("Linear returned no data");
  return json.data;
}

export async function createLinearIssue(
  input: CreateIssueInput,
  config: LinearConfig,
): Promise<{ identifier: string; url: string }> {
  const teams = await graphql<{
    teams: {
      nodes: {
        id: string;
        labels: { nodes: { id: string; name: string }[] };
      }[];
    };
  }>(config, TEAM_QUERY, { key: config.teamKey });

  const team = teams.teams.nodes[0];
  if (!team) throw new Error(`Linear team '${config.teamKey}' not found`);

  const labelIds = input.label
    ? team.labels.nodes
        .filter((l) => l.name.toLowerCase() === input.label?.toLowerCase())
        .map((l) => l.id)
    : [];

  const result = await graphql<{
    issueCreate: {
      success: boolean;
      issue: { identifier: string; url: string } | null;
    };
  }>(config, ISSUE_MUTATION, issueCreateVariables(team.id, input, labelIds));

  if (!result.issueCreate.success || !result.issueCreate.issue) {
    throw new Error("Linear rejected the issue");
  }
  return result.issueCreate.issue;
}

export const ISSUE_OUTBOX = "dev-issues.jsonl";
export const INCIDENT_LOG = "game-incidents.jsonl";

export interface QueuedIssue extends CreateIssueInput {
  reason: string;

  queuedAt: string;
}

export function readQueuedIssues(path = ISSUE_OUTBOX): QueuedIssue[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: QueuedIssue[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as QueuedIssue);
    } catch {}
  }
  return out;
}

export function queueIssue(
  input: CreateIssueInput,
  reason: string,
  queuedAt: string,
  path = ISSUE_OUTBOX,
): number {
  const entry: QueuedIssue = { ...input, reason, queuedAt };
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
  return readQueuedIssues(path).length;
}

export async function flushQueuedIssues(
  config: LinearConfig,
  path = ISSUE_OUTBOX,
): Promise<{ filed: string[]; remaining: number }> {
  const queued = readQueuedIssues(path);
  if (queued.length === 0) return { filed: [], remaining: 0 };

  const filed: string[] = [];
  const stuck: QueuedIssue[] = [];
  for (const q of queued) {
    try {
      const issue = await createLinearIssue(q, config);
      filed.push(issue.identifier);
    } catch {
      stuck.push(q);
    }
  }
  writeFileSync(
    path,
    stuck.map((q) => JSON.stringify(q)).join("\n") + (stuck.length ? "\n" : ""),
  );
  return { filed, remaining: stuck.length };
}

export type ReportStatus = "created" | "queued" | "local" | "failed";

export interface ReportResult {
  status: ReportStatus;
  identifier?: string;
  url?: string;
  error?: string;
  repeatCount?: number;
}

export interface ReportRequest {
  input: CreateIssueInput;
  dev: boolean;
  automatic?: boolean;
  fingerprint?: string;
  recordedAt?: string;
  localPath?: string;
  outboxPath?: string;
}

export interface ReportDependencies {
  resolveConfig?: () => Promise<LinearConfig | null>;
  createIssue?: typeof createLinearIssue;
  queue?: (
    input: CreateIssueInput,
    reason: string,
    queuedAt: string,
    path?: string,
  ) => number;
  append?: (path: string, data: string) => void;
  repeats?: Map<string, number>;
  flush?: typeof flushQueuedIssues;
}

const processRepeats = new Map<string, number>();

export async function submitReport(
  request: ReportRequest,
  dependencies: ReportDependencies = {},
): Promise<ReportResult> {
  const recordedAt = request.recordedAt ?? new Date().toISOString();
  const append = dependencies.append ?? appendFileSync;
  const repeats = dependencies.repeats ?? processRepeats;
  const localPath = request.localPath ?? INCIDENT_LOG;

  if (request.automatic && request.fingerprint) {
    const repeatCount = (repeats.get(request.fingerprint) ?? 0) + 1;
    repeats.set(request.fingerprint, repeatCount);
    if (repeatCount > 1) {
      try {
        append(
          localPath,
          `${JSON.stringify({ type: "repeat", fingerprint: request.fingerprint, repeatCount, recordedAt })}\n`,
        );
        return { status: "local", repeatCount };
      } catch (error) {
        return {
          status: "failed",
          error: (error as Error).message,
          repeatCount,
        };
      }
    }
  }

  if (!request.dev) {
    try {
      append(
        localPath,
        `${JSON.stringify({ type: "incident", ...request.input, fingerprint: request.fingerprint, recordedAt })}\n`,
      );
      return { status: "local" };
    } catch (error) {
      return { status: "failed", error: (error as Error).message };
    }
  }

  const queue = dependencies.queue ?? queueIssue;
  const outboxPath = request.outboxPath ?? ISSUE_OUTBOX;
  try {
    const config = await (dependencies.resolveConfig ?? resolveLinearConfig)();
    if (!config) {
      queue(
        request.input,
        "vercel-identity-unavailable",
        recordedAt,
        outboxPath,
      );
      return { status: "queued" };
    }
    try {
      const issue = await (dependencies.createIssue ?? createLinearIssue)(
        request.input,
        config,
      );
      const flush =
        dependencies.flush ??
        (dependencies.createIssue ? undefined : flushQueuedIssues);
      try {
        await flush?.(config, outboxPath);
      } catch {}
      return { status: "created", ...issue };
    } catch (error) {
      queue(request.input, (error as Error).message, recordedAt, outboxPath);
      return { status: "queued", error: (error as Error).message };
    }
  } catch (error) {
    return { status: "failed", error: (error as Error).message };
  }
}

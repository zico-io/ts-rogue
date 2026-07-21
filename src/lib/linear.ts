/**
 * Minimal Linear issue creation for the dev console's `issue`/`bug` command.
 * Kept out of the engine (this is UI-triggered I/O, like the church save) and
 * split into pure builders (`buildIssueBody`, `issueCreateVariables`) plus one
 * thin async `createLinearIssue`, so the interesting parts are unit-testable
 * without a network.
 *
 * Credentials are brokered by Vercel Connect - the same connector and app token
 * the Eve agent uses (`connectLinearCredentials("linear/ts-rogue-eve")`) - so
 * the console never holds a raw Linear key; the token is minted on demand from
 * the process's Vercel identity (`VERCEL_OIDC_TOKEN`). When that identity is
 * missing or the API call fails, the issue (with its full metadata body) is
 * appended to a local outbox and re-sent on the next successful file/flush, so
 * a report is never lost to a transient credential gap.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { getToken } from "@vercel/connect";

const LINEAR_API = "https://api.linear.app/graphql";

/** Vercel Connect connector storing the Linear app token (matches the Eve agent). */
const LINEAR_CONNECTOR = "linear/ts-rogue-eve";

const TEAM_QUERY = `query($key:String!){teams(filter:{key:{eq:$key}}){nodes{id labels{nodes{id name}}}}}`;
const ISSUE_MUTATION = `mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{identifier url}}}`;

/** Everything the issue body embeds so a reader can reproduce what was seen. */
export interface IssueContext {
  seed: number;
  scene: string;
  /** Full serializable GameState, dumped in a collapsed block. */
  state: unknown;
  /** Tail of `state.log`. */
  logTail: readonly string[];
  /** Contents of `.play-keys.log` when driven by the tmux play harness. */
  keySequence?: string;
  /** Captured screen (tmux capture-pane -p) when harness-driven. */
  frame?: string;
  commit?: string;
  node?: string;
  /** Terminal size, e.g. "120x40". */
  terminal?: string;
}

function fence(body: string, lang = ""): string {
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

function details(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

/** Assemble a reproducible Markdown issue body from live play-session context. */
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
  /** Label name to attach if it exists on the team (e.g. "bug", "feature"). */
  label?: string;
}

export interface LinearConfig {
  /** Linear app access token (Vercel Connect mints it; sent as a Bearer). */
  accessToken: string;
  teamKey: string;
}

/**
 * Mint a Linear app token via Vercel Connect - the same broker and connector
 * the Eve agent uses - so no raw key lives in the game process. Returns null
 * when Connect can't issue one (e.g. no `VERCEL_OIDC_TOKEN`), which the console
 * surfaces as a friendly "credentials unavailable" message.
 */
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

/** Pure builder for the issueCreate mutation variables. */
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

/** Create a Linear issue live. Returns the new issue's identifier and URL. */
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

/** Local outbox: issues that couldn't be filed yet (JSONL, one per line). */
export const ISSUE_OUTBOX = "dev-issues.jsonl";

export interface QueuedIssue extends CreateIssueInput {
  /** Why it was queued: a missing identity or the API error text. */
  reason: string;
  /** ISO timestamp, passed in so this stays free of ambient clock reads. */
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
    } catch {
      // Skip a malformed line rather than dropping the whole queue.
    }
  }
  return out;
}

/** Append an unsent issue (with its full metadata body) to the outbox. */
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

/**
 * Try to file every queued issue; the ones that still fail stay in the outbox.
 * Returns the filed identifiers and how many remain.
 */
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

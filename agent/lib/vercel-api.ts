/**
 * Shared authenticated-fetch plumbing for the `vercel_*` debugging tools
 * (HAR-20). Every tool in `agent/tools/vercel_*.ts` is a thin, typed wrapper
 * over the helpers here: base URL and bearer-header injection, `teamId`
 * query scoping, JSON error-body surfacing, and a bounded NDJSON line
 * reader for the two Vercel endpoints (`runtime-logs`, command `logs`) whose
 * own docs describe them as unbounded streams.
 *
 * There is no existing Vercel-API credential helper in this repo -
 * `@vercel/connect/eve` only wraps GitHub/Linear/Slack connect credentials -
 * so credentials come from plain environment variables instead of a new
 * connection type. `VERCEL_TOKEN` is required; there is no way to mint or
 * verify one in this sandbox, so these tools cannot be exercised against the
 * live API in dev or in tests (see `src/vercel-tools.test.ts`, which mocks
 * `fetch` instead). See `agent/README.md` for the operator-facing
 * requirement to set these before the tools work in production.
 */

const VERCEL_API_BASE = "https://api.vercel.com";

/** Thrown by every helper below instead of letting a bare `fetch` failure or a raw HTTP error body reach the model uninterpreted. */
export class VercelApiError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    options?: { status?: number; code?: string; cause?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "VercelApiError";
    this.status = options?.status;
    this.code = options?.code;
  }
}

export interface VercelCredentials {
  readonly token: string;
  readonly teamId?: string;
}

/**
 * Reads `VERCEL_TOKEN`/`VERCEL_TEAM_ID` from the environment. Throws a
 * clear, actionable error (rather than letting each tool fail later with an
 * opaque fetch/401 error) when the token is unset - a human has to add it to
 * this Vercel project's environment variables first.
 */
export function requireVercelCredentials(): VercelCredentials {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    throw new VercelApiError(
      "VERCEL_TOKEN is not set. A human needs to add a Vercel API token with " +
        "read access to this project to the environment before any vercel_* " +
        "tool can call api.vercel.com - see agent/README.md.",
    );
  }
  return { token, teamId: process.env.VERCEL_TEAM_ID || undefined };
}

/**
 * Resolves a project id from an explicit tool argument, falling back to
 * `VERCEL_PROJECT_ID`. Throws an actionable error when neither is available
 * for an endpoint that requires one.
 */
export function requireProjectId(explicit: string | undefined): string {
  const projectId = explicit ?? process.env.VERCEL_PROJECT_ID;
  if (!projectId) {
    throw new VercelApiError(
      "No project id given and VERCEL_PROJECT_ID is not set. Pass `projectId` explicitly or set VERCEL_PROJECT_ID in the environment.",
    );
  }
  return projectId;
}

export type VercelQuery = Record<string, string | number | boolean | undefined>;

/** Builds an `api.vercel.com` URL, injecting `teamId` unless the caller already set one. */
export function buildVercelUrl(
  path: string,
  query: VercelQuery,
  credentials: VercelCredentials,
): string {
  const url = new URL(path, VERCEL_API_BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  if (credentials.teamId && !url.searchParams.has("teamId")) {
    url.searchParams.set("teamId", credentials.teamId);
  }
  return url.toString();
}

export interface VercelFetchOptions {
  readonly credentials: VercelCredentials;
  readonly query?: VercelQuery;
  readonly method?: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/** Bare authenticated fetch against `api.vercel.com`. Callers decide how to read the body (JSON vs. NDJSON stream). */
export async function vercelFetch(
  path: string,
  options: VercelFetchOptions,
): Promise<Response> {
  const url = buildVercelUrl(path, options.query ?? {}, options.credentials);
  return fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.credentials.token}`,
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
}

/** Parses a non-2xx response's JSON error body (Vercel's `{ error: { code, message } }` shape) into a `VercelApiError`, falling back to the status text when the body isn't JSON. */
export async function vercelErrorFromResponse(
  response: Response,
): Promise<VercelApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const errorObject = (
    body as { error?: { message?: string; code?: string } } | undefined
  )?.error;
  const message =
    errorObject?.message ?? response.statusText ?? "Vercel API request failed";
  return new VercelApiError(`Vercel API ${response.status}: ${message}`, {
    status: response.status,
    code: errorObject?.code,
  });
}

/** Fetches and parses a JSON response, surfacing a non-2xx status as a `VercelApiError`. */
export async function vercelJson<T>(
  path: string,
  options: VercelFetchOptions,
): Promise<T> {
  const response = await vercelFetch(path, options);
  if (!response.ok) {
    throw await vercelErrorFromResponse(response);
  }
  return (await response.json()) as T;
}

export interface NdjsonReadResult<T> {
  /** Parsed lines, in stream order. */
  readonly lines: T[];
  /** True when the read stopped because `maxLines` or the abort signal fired before the stream ended on its own. */
  readonly truncated: boolean;
}

export interface NdjsonToolResult<T> {
  readonly entries: T[];
  readonly count: number;
  readonly truncated: boolean;
}

/** Shared tool-result shape for every `vercel_*` tool that reads a bounded NDJSON stream (runtime logs, command logs). */
export function toNdjsonToolResult<T>(
  result: NdjsonReadResult<T>,
): NdjsonToolResult<T> {
  return {
    entries: result.lines,
    count: result.lines.length,
    truncated: result.truncated,
  };
}

/**
 * Reads a newline-delimited JSON response body, bounded by `maxLines` and,
 * when given, `signal`. The runtime-logs and command-logs endpoints are
 * documented to stream indefinitely, so a tool call against either must
 * never hang waiting for the stream to end on its own.
 *
 * ponytail: a line that fails to `JSON.parse` is skipped rather than
 * aborting the whole read. NDJSON streams occasionally split a chunk across
 * a line boundary or emit a keep-alive; surfacing every line that did parse
 * is more useful than failing the tool call over one bad line. Upgrade path:
 * if this turns out to hide real protocol errors, count and report skipped
 * lines instead of silently dropping them.
 */
export async function readNdjsonLines<T = unknown>(
  response: Response,
  options: { maxLines: number; signal?: AbortSignal },
): Promise<NdjsonReadResult<T>> {
  if (!response.body) return { lines: [], truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const lines: T[] = [];
  let buffer = "";
  let truncated = false;
  try {
    readLoop: while (lines.length < options.maxLines) {
      const chunk = await readOrAbort(reader, options.signal);
      if (chunk === ABORTED) {
        truncated = true;
        break;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (rawLine.length > 0) {
          try {
            lines.push(JSON.parse(rawLine) as T);
          } catch {
            // Skipped: see the ponytail note above.
          }
          if (lines.length >= options.maxLines) {
            truncated = true;
            break readLoop;
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { lines, truncated };
}

const ABORTED = Symbol("ndjson-read-aborted");

/**
 * Races one `reader.read()` against `signal` firing. The bound must not
 * depend on the response's own stream honoring the abort signal (a mocked
 * response in tests, or a server that ignores client aborts, would hang
 * otherwise) - this resolves to `ABORTED` the moment the signal fires,
 * independent of whatever the underlying stream does.
 */
function readOrAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array> | typeof ABORTED> {
  const readPromise = reader.read();
  if (!signal) return readPromise;
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    readPromise.then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Fetches an NDJSON stream and reads it bounded by both a line count and a wall-clock timeout. */
export async function vercelNdjson<T = unknown>(
  path: string,
  options: VercelFetchOptions & { maxLines: number; timeoutMs: number },
): Promise<NdjsonReadResult<T>> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const response = await vercelFetch(path, { ...options, signal });
  if (!response.ok) {
    throw await vercelErrorFromResponse(response);
  }
  return readNdjsonLines<T>(response, { maxLines: options.maxLines, signal });
}

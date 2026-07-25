import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tools are thin wrappers over `agent/lib/vercel-api.ts`'s shared
// fetch helper. There is no live Vercel token available in this sandbox (see
// HAR-20's issue packet), so every test here mocks `global.fetch` instead of
// hitting api.vercel.com, and asserts on the request that was built (URL,
// query params, auth header, body) and on how the response was parsed.
vi.mock("eve/tools", () => ({ defineTool: (def: unknown) => def }));

import type { z } from "zod";

type ToolLike = {
  readonly inputSchema: unknown;
  execute: (input: never, ctx?: never) => Promise<unknown>;
};

/** Mirrors how eve's runtime actually invokes a tool: parse the raw call args against `inputSchema` (applying zod defaults) before calling `execute`. `inputSchema` is typed generically by eve's public API (a standard-schema wrapper), but every tool here authors it with `z.object`/`z.discriminatedUnion`, so it is a real zod schema at runtime. */
function runTool(tool: ToolLike, rawInput: unknown): Promise<unknown> {
  const schema = tool.inputSchema as z.ZodTypeAny;
  const parsed = schema.parse(rawInput);
  return tool.execute(parsed as never, undefined as never);
}

const originalEnv = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ndjsonResponse(lines: unknown[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/** A stream that never closes, to exercise the timeout-truncation path. */
function neverEndingResponse() {
  const stream = new ReadableStream<Uint8Array>({
    start() {
      // Deliberately never enqueue or close.
    },
  });
  return new Response(stream, { status: 200 });
}

beforeEach(() => {
  setEnv({
    VERCEL_TOKEN: "test-token",
    VERCEL_TEAM_ID: undefined,
    VERCEL_PROJECT_ID: "proj_default",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setEnv(originalEnv);
});

describe("agent/lib/vercel-api", () => {
  it("builds URLs with query params and injects teamId when set", async () => {
    const { buildVercelUrl } = await import("../agent/lib/vercel-api");
    setEnv({ VERCEL_TEAM_ID: "team_1" });
    const url = buildVercelUrl(
      "/v1/projects/traces",
      { requestId: "req_1", projectId: "proj_1", skip: undefined },
      { token: "t", teamId: "team_1" },
    );
    expect(url).toBe(
      "https://api.vercel.com/v1/projects/traces?requestId=req_1&projectId=proj_1&teamId=team_1",
    );
  });

  it("does not override an explicitly set teamId query param", async () => {
    const { buildVercelUrl } = await import("../agent/lib/vercel-api");
    const url = buildVercelUrl(
      "/v2/sandboxes",
      { teamId: "explicit" },
      { token: "t", teamId: "from-credentials" },
    );
    expect(url).toBe("https://api.vercel.com/v2/sandboxes?teamId=explicit");
  });

  it("requireVercelCredentials throws an actionable error when VERCEL_TOKEN is unset", async () => {
    setEnv({ VERCEL_TOKEN: undefined });
    const { requireVercelCredentials, VercelApiError } = await import(
      "../agent/lib/vercel-api"
    );
    expect(() => requireVercelCredentials()).toThrow(VercelApiError);
    expect(() => requireVercelCredentials()).toThrow(/VERCEL_TOKEN is not set/);
  });

  it("requireProjectId falls back to VERCEL_PROJECT_ID and errors when neither is set", async () => {
    const { requireProjectId, VercelApiError } = await import(
      "../agent/lib/vercel-api"
    );
    expect(requireProjectId(undefined)).toBe("proj_default");
    expect(requireProjectId("proj_explicit")).toBe("proj_explicit");
    setEnv({ VERCEL_PROJECT_ID: undefined });
    expect(() => requireProjectId(undefined)).toThrow(VercelApiError);
  });

  it("vercelJson surfaces a non-2xx JSON error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: "forbidden", message: "nope" } }, 403),
        ),
    );
    const { vercelJson, VercelApiError } = await import(
      "../agent/lib/vercel-api"
    );
    await expect(
      vercelJson("/v2/sandboxes", { credentials: { token: "t" } }),
    ).rejects.toMatchObject({
      constructor: VercelApiError,
      status: 403,
      code: "forbidden",
      message: expect.stringContaining("nope"),
    });
  });

  it("readNdjsonLines bounds the number of lines read and reports truncation", async () => {
    const { readNdjsonLines } = await import("../agent/lib/vercel-api");
    const response = ndjsonResponse([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    const result = await readNdjsonLines(response, { maxLines: 2 });
    expect(result.lines).toEqual([{ n: 1 }, { n: 2 }]);
    expect(result.truncated).toBe(true);
  });

  it("readNdjsonLines reads every line and reports no truncation when the stream ends first", async () => {
    const { readNdjsonLines } = await import("../agent/lib/vercel-api");
    const response = ndjsonResponse([{ n: 1 }, { n: 2 }]);
    const result = await readNdjsonLines(response, { maxLines: 10 });
    expect(result.lines).toEqual([{ n: 1 }, { n: 2 }]);
    expect(result.truncated).toBe(false);
  });

  it("skips a malformed NDJSON line instead of failing the whole read", async () => {
    const { readNdjsonLines } = await import("../agent/lib/vercel-api");
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"n":1}\nnot json\n{"n":2}\n'));
        controller.close();
      },
    });
    const result = await readNdjsonLines(new Response(stream), {
      maxLines: 10,
    });
    expect(result.lines).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("vercelNdjson times out on a hanging stream instead of blocking forever", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(neverEndingResponse()));
    const { vercelNdjson } = await import("../agent/lib/vercel-api");
    const result = await vercelNdjson("/v1/x", {
      credentials: { token: "t" },
      maxLines: 100,
      timeoutMs: 25,
    });
    expect(result.lines).toEqual([]);
    expect(result.truncated).toBe(true);
  });
});

describe("vercel_logs tool", () => {
  it("errors clearly when VERCEL_TOKEN is unset, without calling fetch", async () => {
    setEnv({ VERCEL_TOKEN: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_logs"))
      .default as unknown as ToolLike;
    await expect(runTool(tool, { deploymentId: "dpl_1" })).rejects.toThrow(
      /VERCEL_TOKEN is not set/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the deployment's runtime-logs with query params, bearer auth, and bounds the read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([
        { rowId: "1", level: "info", message: "a" },
        { rowId: "2", level: "error", message: "b" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_logs"))
      .default as unknown as ToolLike;

    const result = (await runTool(tool, {
      deploymentId: "dpl_1",
      since: 1000,
      until: 2000,
      maxLines: 10,
      timeoutMs: 5000,
    })) as { entries: unknown[]; count: number; truncated: boolean };

    expect(result.count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.entries).toEqual([
      { rowId: "1", level: "info", message: "a" },
      { rowId: "2", level: "error", message: "b" },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.vercel.com/v1/projects/proj_default/deployments/dpl_1/runtime-logs?since=1000&until=2000",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
  });

  it("surfaces a non-2xx error from the runtime-logs endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "no deployment" } }, 404),
        ),
    );
    const tool = (await import("../agent/tools/vercel_logs"))
      .default as unknown as ToolLike;
    await expect(runTool(tool, { deploymentId: "missing" })).rejects.toThrow(
      /no deployment/,
    );
  });
});

describe("vercel_trace tool", () => {
  it("requests /v1/projects/traces with projectId and requestId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ trace: { traceId: "t1", spans: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_trace"))
      .default as unknown as ToolLike;

    const result = await runTool(tool, { requestId: "req_1" });

    expect(result).toEqual({ trace: { traceId: "t1", spans: [] } });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.vercel.com/v1/projects/traces?projectId=proj_default&requestId=req_1",
    );
  });

  it("errors clearly when VERCEL_TOKEN is unset", async () => {
    setEnv({ VERCEL_TOKEN: undefined });
    const tool = (await import("../agent/tools/vercel_trace"))
      .default as unknown as ToolLike;
    await expect(runTool(tool, { requestId: "req_1" })).rejects.toThrow(
      /VERCEL_TOKEN is not set/,
    );
  });

  it("surfaces a 401 from the trace endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "bad token" } }, 401),
        ),
    );
    const tool = (await import("../agent/tools/vercel_trace"))
      .default as unknown as ToolLike;
    await expect(runTool(tool, { requestId: "req_1" })).rejects.toThrow(
      /bad token/,
    );
  });
});

describe("vercel_observability_query tool", () => {
  it("mode: schema lists metrics", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ metrics: [{ id: "m1", description: "d" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_observability_query"))
      .default as unknown as ToolLike;

    const result = await runTool(tool, { mode: "schema" });

    expect(result).toEqual({ metrics: [{ id: "m1", description: "d" }] });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.vercel.com/v2/observability/schema");
  });

  it("mode: schema with a metricId fetches that metric's detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: "m1" }]));
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_observability_query"))
      .default as unknown as ToolLike;

    await runTool(tool, { mode: "schema", metricId: "m1" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.vercel.com/v2/observability/schema/m1");
  });

  it("mode: query POSTs metric/scope/filter and defaults scope from VERCEL_PROJECT_ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_observability_query"))
      .default as unknown as ToolLike;

    await runTool(tool, {
      mode: "query",
      metric: "workflow_runs",
      filter: "$eve.root eq 'abc'",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.vercel.com/v2/observability/query");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      metric: "workflow_runs",
      scope: { projectId: "proj_default" },
      filter: "$eve.root eq 'abc'",
    });
  });

  it("mode: query errors when no scope and no VERCEL_PROJECT_ID are available", async () => {
    setEnv({ VERCEL_PROJECT_ID: undefined });
    const tool = (await import("../agent/tools/vercel_observability_query"))
      .default as unknown as ToolLike;

    await expect(
      runTool(tool, { mode: "query", metric: "workflow_runs" }),
    ).rejects.toThrow(/requires `scope`/);
  });

  it("surfaces a query-engine error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "bad filter" } }, 400),
        ),
    );
    const tool = (await import("../agent/tools/vercel_observability_query"))
      .default as unknown as ToolLike;
    await expect(
      runTool(tool, { mode: "query", metric: "workflow_runs" }),
    ).rejects.toThrow(/bad filter/);
  });
});

describe("vercel_sandboxes tool", () => {
  it("lists sandboxes with filters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ sandboxes: [], pagination: { count: 0, next: null } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_sandboxes"))
      .default as unknown as ToolLike;

    await runTool(tool, {
      resource: "sandbox",
      action: "list",
      status: "running",
      namePrefix: "eve-",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.vercel.com/v2/sandboxes?status=running&namePrefix=eve-",
    );
  });

  it("gets one sandbox by name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sandbox: { name: "eve-1", status: "running" },
        session: { id: "sess_1" },
        routes: [],
        resumed: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_sandboxes"))
      .default as unknown as ToolLike;

    const result = await runTool(tool, {
      resource: "sandbox",
      action: "get",
      name: "eve-1",
    });

    expect((result as { sandbox: { name: string } }).sandbox.name).toBe(
      "eve-1",
    );
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.vercel.com/v2/sandboxes/eve-1");
  });

  it("gets a session by id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ session: { id: "sess_1" }, routes: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_sandboxes"))
      .default as unknown as ToolLike;

    await runTool(tool, {
      resource: "session",
      action: "get",
      sessionId: "sess_1",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.vercel.com/v2/sandboxes/sessions/sess_1");
  });

  it("surfaces a 404 when a named sandbox does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "not found" } }, 404),
        ),
    );
    const tool = (await import("../agent/tools/vercel_sandboxes"))
      .default as unknown as ToolLike;
    await expect(
      runTool(tool, { resource: "sandbox", action: "get", name: "ghost" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("vercel_sandbox_commands tool", () => {
  it("lists commands for a session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ commands: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_sandbox_commands"))
      .default as unknown as ToolLike;

    await runTool(tool, { action: "list", sessionId: "sess_1" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.vercel.com/v2/sandboxes/sessions/sess_1/cmd");
  });

  it("gets one command, forwarding wait=true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ command: { id: "cmd_1", exitCode: 0 } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_sandbox_commands"))
      .default as unknown as ToolLike;

    await runTool(tool, {
      action: "get",
      sessionId: "sess_1",
      cmdId: "cmd_1",
      wait: true,
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.vercel.com/v2/sandboxes/sessions/sess_1/cmd/cmd_1?wait=true",
    );
  });

  it("reads a command's NDJSON logs bounded by maxLines", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      ndjsonResponse([
        { stream: "stdout", data: "line 1" },
        { stream: "stdout", data: "line 2" },
        { stream: "stderr", data: "line 3" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = (await import("../agent/tools/vercel_sandbox_commands"))
      .default as unknown as ToolLike;

    const result = (await runTool(tool, {
      action: "logs",
      sessionId: "sess_1",
      cmdId: "cmd_1",
      maxLines: 2,
      timeoutMs: 5000,
    })) as { entries: unknown[]; count: number; truncated: boolean };

    expect(result.count).toBe(2);
    expect(result.truncated).toBe(true);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://api.vercel.com/v2/sandboxes/sessions/sess_1/cmd/cmd_1/logs",
    );
  });

  it("surfaces an error when the session or command does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { message: "no such command" } }, 404),
        ),
    );
    const tool = (await import("../agent/tools/vercel_sandbox_commands"))
      .default as unknown as ToolLike;
    await expect(
      runTool(tool, { action: "get", sessionId: "sess_1", cmdId: "ghost" }),
    ).rejects.toThrow(/no such command/);
  });

  it("errors clearly when VERCEL_TOKEN is unset", async () => {
    setEnv({ VERCEL_TOKEN: undefined });
    const tool = (await import("../agent/tools/vercel_sandbox_commands"))
      .default as unknown as ToolLike;
    await expect(
      runTool(tool, { action: "list", sessionId: "sess_1" }),
    ).rejects.toThrow(/VERCEL_TOKEN is not set/);
  });
});

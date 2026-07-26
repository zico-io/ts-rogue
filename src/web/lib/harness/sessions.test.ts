import { afterEach, describe, expect, it } from "vitest";
import { EVE_TAG } from "./eveTags";
import { getSessionTree, listRecentRootSessions } from "./sessions";

const ENV_KEYS = [
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
  "VERCEL_PROJECT_ID",
] as const;

function setEnv() {
  process.env.VERCEL_TOKEN = "token";
  process.env.VERCEL_TEAM_ID = "team_1";
  process.env.VERCEL_PROJECT_ID = "prj_1";
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("listRecentRootSessions", () => {
  afterEach(clearEnv);

  it("surfaces observability_plus_required without throwing when the plan is missing", async () => {
    setEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(402, { error: {} })) as typeof fetch;
    try {
      const result = await listRecentRootSessions();
      expect(result).toEqual({
        ok: false,
        reason: "observability_plus_required",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("builds session summaries from the runs + completion query responses", async () => {
    setEnv();
    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = (async (_url, init) => {
      call += 1;
      const body = JSON.parse(String((init as RequestInit).body));
      if (body.metric === "vercel.workflow_operation.runs") {
        return jsonResponse(200, {
          data: [
            {
              tags: {
                [EVE_TAG.root]: "sess-1",
                [EVE_TAG.type]: "session",
                [EVE_TAG.trigger]: "linear",
                [EVE_TAG.title]: "HAR-50",
                [EVE_TAG.inputTokens]: "10",
                [EVE_TAG.outputTokens]: "5",
              },
            },
            {
              tags: {
                [EVE_TAG.root]: "sess-1",
                [EVE_TAG.type]: "subagent",
                [EVE_TAG.subagent]: "coder",
                [EVE_TAG.inputTokens]: "90",
                [EVE_TAG.outputTokens]: "40",
              },
            },
          ],
        });
      }
      if (body.metric === "vercel.workflow_operation.run_completed") {
        return jsonResponse(200, {
          data: [
            { tags: { [EVE_TAG.root]: "sess-1", [EVE_TAG.subagent]: "coder" } },
          ],
        });
      }
      return jsonResponse(200, { data: [] });
    }) as typeof fetch;

    try {
      const result = await listRecentRootSessions();
      expect(result).toEqual({
        ok: true,
        sessions: [
          {
            id: "sess-1",
            title: "HAR-50",
            trigger: "linear",
            status: "running",
            inputTokens: 100,
            outputTokens: 45,
            cacheReadTokens: 0,
          },
        ],
      });
      // one runs query + one completed/failed/cancelled query each
      expect(call).toBe(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getSessionTree", () => {
  afterEach(clearEnv);

  it("returns not_found when the query returns no rows for that session", async () => {
    setEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(200, { data: [] })) as typeof fetch;
    try {
      const result = await getSessionTree("sess-missing");
      expect(result).toEqual({ ok: false, reason: "not_found" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns the session's subagent tree when rows exist", async () => {
    setEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      if (body.metric === "vercel.workflow_operation.runs") {
        return jsonResponse(200, {
          data: [
            { tags: { [EVE_TAG.root]: "sess-1", [EVE_TAG.type]: "turn" } },
            {
              tags: {
                [EVE_TAG.root]: "sess-1",
                [EVE_TAG.type]: "subagent",
                [EVE_TAG.subagent]: "coder",
              },
            },
          ],
        });
      }
      return jsonResponse(200, { data: [] });
    }) as typeof fetch;

    try {
      const result = await getSessionTree("sess-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.session.id).toBe("sess-1");
        expect(result.session.children).toHaveLength(1);
        expect(result.session.children[0]?.subagent).toBe("coder");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

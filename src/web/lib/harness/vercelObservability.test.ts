import { describe, expect, it } from "vitest";
import type { VercelApiEnv } from "./vercelEnv";
import {
  normalizeObservabilityRows,
  queryObservability,
} from "./vercelObservability";

const env: VercelApiEnv = {
  token: "test-token",
  teamId: "team_1",
  projectId: "prj_1",
};

describe("queryObservability", () => {
  it("returns upstream_error when no Vercel credentials are resolvable", async () => {
    const outcome = await queryObservability(
      {
        metric: "vercel.workflow_operation.runs",
        startTime: "a",
        endTime: "b",
      },
      null,
    );
    expect(outcome).toEqual({ ok: false, reason: "upstream_error" });
  });

  it("sends the documented request shape and never puts the token in the URL", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchSpy = async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const outcome = await queryObservability(
        {
          metric: "vercel.workflow_operation.runs",
          aggregation: "sum",
          groupBy: ["tags/'$eve.root'"],
          startTime: "2026-01-01T00:00:00Z",
          endTime: "2026-01-02T00:00:00Z",
        },
        env,
      );

      expect(outcome).toEqual({ ok: true, raw: { data: [] } });
      expect(capturedUrl).toBe("https://api.vercel.com/v2/observability/query");
      expect(capturedInit?.method).toBe("POST");
      expect(capturedUrl).not.toContain("test-token");

      const body = JSON.parse(String(capturedInit?.body));
      expect(body.metric).toBe("vercel.workflow_operation.runs");
      expect(body.scope).toEqual({
        type: "project",
        ownerId: "team_1",
        projectIds: ["prj_1"],
      });
      expect(body.groupBy).toEqual(["tags/'$eve.root'"]);
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer test-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports observability_plus_required on a 402 without surfacing the body as data", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: "payment_required" } }), {
        status: 402,
      })) as typeof fetch;
    try {
      const outcome = await queryObservability(
        {
          metric: "vercel.workflow_operation.runs",
          startTime: "a",
          endTime: "b",
        },
        env,
      );
      expect(outcome).toEqual({
        ok: false,
        reason: "observability_plus_required",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports upstream_error on any other non-2xx response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("nope", { status: 500 })) as typeof fetch;
    try {
      const outcome = await queryObservability(
        {
          metric: "vercel.workflow_operation.runs",
          startTime: "a",
          endTime: "b",
        },
        env,
      );
      expect(outcome).toEqual({ ok: false, reason: "upstream_error" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports upstream_error when fetch itself throws (network failure)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    try {
      const outcome = await queryObservability(
        {
          metric: "vercel.workflow_operation.runs",
          startTime: "a",
          endTime: "b",
        },
        env,
      );
      expect(outcome).toEqual({ ok: false, reason: "upstream_error" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("normalizeObservabilityRows", () => {
  it("reads a data array of tags/value rows", () => {
    const rows = normalizeObservabilityRows({
      data: [{ tags: { "$eve.root": "sess-1" }, value: 3 }],
    });
    expect(rows).toEqual([{ tags: { "$eve.root": "sess-1" }, value: 3 }]);
  });

  it("skips rows without a tags object", () => {
    const rows = normalizeObservabilityRows({
      data: [{ dimensions: { "$eve.root": "sess-2" }, count: 5 }],
    });
    expect(rows).toEqual([]);
  });

  it("returns an empty array for unrecognized shapes", () => {
    expect(normalizeObservabilityRows(null)).toEqual([]);
    expect(normalizeObservabilityRows({})).toEqual([]);
    expect(normalizeObservabilityRows({ unexpected: true })).toEqual([]);
    expect(
      normalizeObservabilityRows([{ tags: { a: "1" }, value: 1 }]),
    ).toEqual([]);
    expect(
      normalizeObservabilityRows({ rows: [{ tags: { a: "1" }, value: 1 }] }),
    ).toEqual([]);
  });

  it("drops non-string tag values and defaults a missing value to 0", () => {
    const rows = normalizeObservabilityRows({
      data: [{ tags: { "$eve.root": "sess-3", weird: 42 } }],
    });
    expect(rows).toEqual([{ tags: { "$eve.root": "sess-3" }, value: 0 }]);
  });
});

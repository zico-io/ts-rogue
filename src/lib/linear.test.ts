import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIssueBody,
  createLinearIssue,
  flushQueuedIssues,
  issueCreateVariables,
  queueIssue,
  readQueuedIssues,
  submitReport,
} from "./linear";

describe("buildIssueBody", () => {
  const base = {
    seed: 42,
    scene: "dungeon",
    state: { seed: 42, scene: "dungeon" },
    logTail: ["A monster ambushes the party!"],
  };

  it("embeds a deterministic repro command with the seed", () => {
    const body = buildIssueBody(base);
    expect(body).toContain("pnpm game:dev --seed=42 --fresh");
    expect(body).toContain('"scene": "dungeon"');
    expect(body).toContain("A monster ambushes the party!");
  });

  it("includes the key sequence and captured frame when present", () => {
    const body = buildIssueBody({
      ...base,
      keySequence: "3\nj\no",
      frame: "+-- Dungeon --+",
      commit: "abc123",
    });
    expect(body).toContain("## Key sequence");
    expect(body).toContain("3\nj\no");
    expect(body).toContain("captured from play session");
    expect(body).toContain("abc123");
  });

  it("omits the frame/key sections when not harness-driven", () => {
    const body = buildIssueBody(base);
    expect(body).not.toContain("## Key sequence");
    expect(body).not.toContain("## Screen");
  });

  it("includes automatic incident metadata and its debug journal", () => {
    const body = buildIssueBody({
      ...base,
      incident: {
        category: "reducer",
        message: "boom",
        stack: "Error: boom\n at reduce",
        triggeringEvent: "BattleAttack",
        fingerprint: "inc-123",
        journal: [{ event: "BattleAttack" }],
      },
    });
    expect(body).toContain("Category: `reducer`");
    expect(body).toContain("Fingerprint: `inc-123`");
    expect(body).toContain("BattleAttack");
    expect(body).toContain("Error: boom");
  });
});

describe("issueCreateVariables", () => {
  it("attaches labelIds only when present", () => {
    expect(
      issueCreateVariables("team-1", { title: "t", body: "b" }, []).input,
    ).toEqual({ teamId: "team-1", title: "t", description: "b" });
    expect(
      issueCreateVariables("team-1", { title: "t", body: "b" }, ["lbl-1"])
        .input,
    ).toMatchObject({ labelIds: ["lbl-1"] });
  });
});

describe("createLinearIssue", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves the team, maps the label, and returns the new identifier", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            teams: {
              nodes: [
                {
                  id: "team-1",
                  labels: { nodes: [{ id: "lbl-bug", name: "Bug" }] },
                },
              ],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            issueCreate: {
              success: true,
              issue: {
                identifier: "ROG-99",
                url: "https://linear.app/x/ROG-99",
              },
            },
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const issue = await createLinearIssue(
      { title: "crash", body: "body", label: "bug" },
      { accessToken: "k", teamKey: "ROG" },
    );

    expect(issue.identifier).toBe("ROG-99");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer k");
    const mutationVars = JSON.parse(fetchMock.mock.calls[1][1].body).variables;
    expect(mutationVars.input.labelIds).toEqual(["lbl-bug"]);
    expect(mutationVars.input.teamId).toBe("team-1");
  });

  it("throws a readable error on GraphQL errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ errors: [{ message: "Invalid API key" }] }),
      }),
    );
    await expect(
      createLinearIssue(
        { title: "t", body: "b" },
        { accessToken: "bad", teamKey: "ROG" },
      ),
    ).rejects.toThrow("Invalid API key");
  });
});

describe("issue outbox", () => {
  const outbox = join(tmpdir(), "ts-rogue-outbox-test.jsonl");
  afterEach(() => {
    rmSync(outbox, { force: true });
    vi.unstubAllGlobals();
  });

  it("queues issues with metadata and reads them back", () => {
    expect(readQueuedIssues(outbox)).toEqual([]);
    expect(
      queueIssue(
        { title: "t", body: "b", label: "bug" },
        "no-creds",
        "T0",
        outbox,
      ),
    ).toBe(1);
    queueIssue({ title: "t2", body: "b2" }, "boom", "T1", outbox);
    const queued = readQueuedIssues(outbox);
    expect(queued).toHaveLength(2);
    expect(queued[0]).toMatchObject({
      title: "t",
      body: "b",
      label: "bug",
      reason: "no-creds",
      queuedAt: "T0",
    });
  });

  it("flushes queued issues, keeping the ones that still fail", async () => {
    queueIssue({ title: "ok", body: "b" }, "r", "T0", outbox);
    queueIssue({ title: "fails", body: "b" }, "r", "T0", outbox);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const { query, variables } = JSON.parse(init.body);
        if (query.includes("teams")) {
          return {
            ok: true,
            json: async () => ({
              data: {
                teams: { nodes: [{ id: "team-1", labels: { nodes: [] } }] },
              },
            }),
          };
        }
        if (variables.input.title === "fails") {
          return {
            ok: true,
            json: async () => ({ errors: [{ message: "boom" }] }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              issueCreate: {
                success: true,
                issue: { identifier: "ROG-ok", url: "u" },
              },
            },
          }),
        };
      }),
    );

    const result = await flushQueuedIssues(
      { accessToken: "k", teamKey: "ROG" },
      outbox,
    );
    expect(result.filed).toEqual(["ROG-ok"]);
    expect(result.remaining).toBe(1);
    expect(readQueuedIssues(outbox).map((q) => q.title)).toEqual(["fails"]);
  });
});

describe("submitReport", () => {
  const input = { title: "crash", body: "packet", label: "bug" };

  it("returns created after a successful dev filing", async () => {
    const result = await submitReport(
      { input, dev: true },
      {
        resolveConfig: async () => ({ accessToken: "k", teamKey: "ROG" }),
        createIssue: async () => ({ identifier: "ROG-1", url: "u" }),
      },
    );
    expect(result).toMatchObject({ status: "created", identifier: "ROG-1" });
  });

  it("queues dev reports when credentials or the API fail", async () => {
    const queued: string[] = [];
    const queue = (_input: { title: string }, reason: string) => {
      queued.push(reason);
      return queued.length;
    };
    expect(
      await submitReport(
        { input, dev: true },
        { resolveConfig: async () => null, queue },
      ),
    ).toMatchObject({ status: "queued" });
    expect(
      await submitReport(
        { input, dev: true },
        {
          resolveConfig: async () => ({ accessToken: "k", teamKey: "ROG" }),
          createIssue: async () => {
            throw new Error("offline");
          },
          queue,
        },
      ),
    ).toMatchObject({ status: "queued", error: "offline" });
    expect(queued).toEqual(["vercel-identity-unavailable", "offline"]);
  });

  it("writes normal-mode reports locally and surfaces local write failure", async () => {
    const lines: string[] = [];
    expect(
      await submitReport(
        { input, dev: false, fingerprint: "inc-a", recordedAt: "T0" },
        { append: (_path, line) => lines.push(String(line)) },
      ),
    ).toEqual({ status: "local" });
    expect(lines[0]).toContain('"fingerprint":"inc-a"');
    expect(
      await submitReport(
        { input, dev: false },
        {
          append: () => {
            throw new Error("disk full");
          },
        },
      ),
    ).toEqual({ status: "failed", error: "disk full" });
  });

  it("files an automatic fingerprint once and records repeat counts locally", async () => {
    const repeats = new Map<string, number>();
    const filed: string[] = [];
    const local: string[] = [];
    const dependencies = {
      repeats,
      resolveConfig: async () => ({ accessToken: "k", teamKey: "ROG" }),
      createIssue: async () => {
        filed.push("filed");
        return { identifier: "ROG-2", url: "u" };
      },
      append: (_path: string, line: string) => local.push(line),
    };
    const request = {
      input,
      dev: true,
      automatic: true,
      fingerprint: "inc-repeat",
    };
    expect((await submitReport(request, dependencies)).status).toBe("created");
    expect(await submitReport(request, dependencies)).toMatchObject({
      status: "local",
      repeatCount: 2,
    });
    expect(filed).toHaveLength(1);
    expect(local[0]).toContain('"repeatCount":2');
  });

  it("does not deduplicate manual reports", async () => {
    const filed: string[] = [];
    const dependencies = {
      repeats: new Map<string, number>(),
      resolveConfig: async () => ({ accessToken: "k", teamKey: "ROG" }),
      createIssue: async () => {
        filed.push("filed");
        return { identifier: "ROG-3", url: "u" };
      },
    };
    const request = { input, dev: true, fingerprint: "inc-manual" };
    await submitReport(request, dependencies);
    await submitReport(request, dependencies);
    expect(filed).toHaveLength(2);
  });
});

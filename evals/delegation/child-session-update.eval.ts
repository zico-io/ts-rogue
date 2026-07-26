import { createServer, type Server } from "node:http";

import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import {
  DELEGATION_TRIGGER,
  MOCK_AGENT_SESSION_ID,
  MOCK_ISSUE_ID,
  MOCK_LINEAR_PORT,
} from "../../agent/lib/mock-delegation";






















export default defineEval({
  description:
    "delegated child's completed session_update is refused in code; only its blocked update reaches Linear, issue-prefixed",
  timeoutMs: 120_000,
  async test(t) {
    if (!process.env.EVE_EVAL_MOCK_MODEL) {
      t.skip(
        "EVE_EVAL_MOCK_MODEL not set - this eval drives the scripted mock-model harness (see file header for the invocation)",
      );
      return;
    }

    const bodies: string[] = [];
    const server: Server = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        bodies.push(data);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            data: {
              agentActivityCreate: {
                success: true,
                agentActivity: { id: "mock-activity" },
              },
            },
          }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(MOCK_LINEAR_PORT, "127.0.0.1", resolve);
    });

    try {
      await t.send(DELEGATION_TRIGGER);
      t.succeeded();
      t.calledSubagent("agent", { count: 1 });

      const called = t.events.find(
        (event) => event.type === "subagent.called",
      ) as { data?: { childSessionId?: string } } | undefined;
      const childSessionId = await t.require(
        called?.data?.childSessionId,
        satisfies(
          (id) => typeof id === "string" && id.length > 0,
          "subagent.called carried the child session id",
        ),
      );

      const child = await t.target.attachSession(childSessionId as string);
      child.calledTool("session_update", {
        count: 2,
        input: { agentSessionId: MOCK_AGENT_SESSION_ID },
      });






      const activityBodies = bodies.filter((body) =>
        body.includes("agentActivityCreate"),
      );
      t.check(
        activityBodies,
        satisfies(
          (posted: string[]) =>
            posted.length === 1 &&
            posted[0]!.includes(`**Blocked**`) &&
            posted[0]!.includes(`[${MOCK_ISSUE_ID}]`) &&
            !posted[0]!.includes(`**Completed**`) &&
            !posted[0]!.includes(`**Progress**`),
          "only the blocked update reached Linear, issue-prefixed; the completed attempt was refused without posting",
        ),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

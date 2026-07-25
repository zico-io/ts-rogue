import { createServer, type Server } from "node:http";

import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

import {
  DELEGATION_TRIGGER,
  MOCK_AGENT_SESSION_ID,
  MOCK_ISSUE_ID,
  MOCK_LINEAR_PORT,
} from "../../agent/lib/mock-delegation";

// Covers the delegation-path wiring no other eval reaches: a real child
// session spawned by the built-in `agent` tool, the child-relay hook capturing
// a non-blank agent_session_id from the packet, and session_update's
// role coercion (`completed` -> `progress` with the `[<issue>]` prefix)
// applied by the real execute with the real ctx.session.parent. The model is
// eve's mockModel (scripted in agent/lib/mock-delegation.ts); everything else
// - harness, tools, hooks, child session - runs for real. The coerced status
// exists only inside the GraphQL body session_update posts, so the eval runs
// a local mock Linear GraphQL server and reads what arrived.
//
// Scope, honestly: this proves runtime wiring, not model policy - a scripted
// root always delegates. Run it with:
//   EVE_EVAL_MOCK_MODEL=1 LINEAR_API_BASE_URL=http://127.0.0.1:47831 \
//     pnpm exec eve eval delegation
// It needs no model-provider or Linear credentials. Without the env flag it
// skips, keeping plain `eve eval` and the remote ralph CI run green. Run it
// without Vercel sandbox credentials: child-relay's root half awaits
// getSandbox() in the emit path, which fails fast (warn-only) locally but
// would await a cold sandbox bootstrap with credentials present. That file
// handoff stays covered by src/child-relay.test.ts.
export default defineEval({
  description:
    "delegated child's session_update reaches Linear with its status coerced to progress and the issue prefix",
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
        count: 1,
        input: { agentSessionId: MOCK_AGENT_SESSION_ID },
      });

      // The payoff: the activity that reached (mock) Linear carries the
      // child-coerced body, end to end through the real hook state and the
      // real execute.
      const activityBodies = bodies.filter((body) =>
        body.includes("agentActivityCreate"),
      );
      t.check(
        activityBodies,
        satisfies(
          (posted: string[]) =>
            posted.length === 1 &&
            posted[0]!.includes(`**Progress**`) &&
            posted[0]!.includes(`[${MOCK_ISSUE_ID}]`) &&
            !posted[0]!.includes(`**Completed**`),
          "posted activity body was coerced to Progress with the issue prefix",
        ),
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

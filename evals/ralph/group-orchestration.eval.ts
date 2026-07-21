import { defineEval } from "eve/evals";

import { drivesIssue, linearDelegation, ralphFixture } from "./shared";

// End-to-end guard for ralph mode (issue groups). It drives the REAL agent
// against a dedicated Linear parent whose sub-issues carry blocking relations,
// so the agent must read the group over the Linear MCP and sequence it in a real
// sandbox. It watches for the moment the agent commits to a sub-issue - a branch
// off main, a delegation, or a move to In Progress - then cancels, so it
// observes the sequencing decision without completing a build or opening a PR.
//
// See ./shared.ts for the fixture: a Done predecessor unblocks READY while
// BLOCKED stays blocked, so the one correct move is to drive READY. That single
// turn covers the whole rule - honoring a merged predecessor (advance-after-
// merge), skipping finished work, and not jumping ahead. The merge webhook that
// re-invokes the agent to advance is wired and unit-tested in
// src/github-agent.test.ts; here we prove the sequencing it advances by.
//
// Run against the deployed target (or a sandbox-configured env), where the
// Vercel Sandbox and Linear MCP are reachable:
//   RALPH_EVAL_PARENT=ROG-200 RALPH_EVAL_READY=ROG-202 RALPH_EVAL_BLOCKED=ROG-203 \
//     eve eval ralph --url https://<deployment>
// Thresholds are a baseline; tune on the first authenticated run.
export default defineEval({
  description:
    "sequences a Linear issue group by blocking relations and drives the ready sub-issue first, not the blocked one",
  timeoutMs: 300_000,
  async test(t) {
    const fixture = ralphFixture();
    if (!fixture) {
      t.skip(
        "set RALPH_EVAL_PARENT/READY/BLOCKED to a Linear test group to run this E2E",
      );
      return;
    }
    const { parent, ready, blocked } = fixture;

    const live = await t.start(linearDelegation(parent));

    // Cancel as soon as the agent commits to driving the ready sub-issue, before
    // the coding child runs a full build. If it never does within the turn, fall
    // through and let the settled-run assertions record the failure cleanly.
    try {
      await live.waitForEvent("actions.requested", {
        data: {
          actions: (actions) => actions.some((a) => drivesIssue(a, ready)),
        },
      });
    } catch {
      // no-op: assertions below read whatever the turn produced
    }
    await live.cancel();
    await live.result();

    t.eventsSatisfy("drove the ready sub-issue", (events) =>
      events.some((event) => drivesIssue(event, ready)),
    );
    t.eventsSatisfy("did not drive the blocked sub-issue", (events) =>
      events.every((event) => !drivesIssue(event, blocked)),
    );
  },
});

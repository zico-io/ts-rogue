import { defineEval } from "eve/evals";

import { drivesIssue, linearDelegation, RALPH_FIXTURE } from "./shared";




















export default defineEval({
  description:
    "sequences a Linear issue group by blocking relations and drives the ready sub-issue first, not the blocked one",
  timeoutMs: 300_000,
  async test(t) {
    if (!process.env.EVE_EVAL_AUTH_TOKEN) {
      t.skip(
        "no EVE_EVAL_AUTH_TOKEN - this E2E runs against the authenticated deployment (CI mints one via GitHub OIDC)",
      );
      return;
    }
    const { parent, ready, blocked } = RALPH_FIXTURE;

    const live = await t.start(linearDelegation(parent));




    try {
      await live.waitForEvent("actions.requested", {
        data: {
          actions: (actions) => actions.some((a) => drivesIssue(a, ready)),
        },
      });
    } catch {

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

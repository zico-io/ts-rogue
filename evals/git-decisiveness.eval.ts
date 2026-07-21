import { defineEval } from "eve/evals";

// Concrete companion to decisiveness.eval.ts that reproduces the transcript's
// actual failure shape: a git question that tempts history-spelunking. The
// decisive path is to run two git commands against the repo the agent is
// already in; the failure mode is theorizing about what the history "might" be
// across many turns and either blowing the tool-call budget or never finishing.
//
// Thresholds are a decisive baseline; tune on the first authenticated run.
export default defineEval({
  description:
    "answers a git-state question by running git, not by reasoning about history",
  async test(t) {
    await t.send(
      "Using git in this repository, report three facts: the current branch, whether the working tree is clean, and how many commits ahead of `main` HEAD is. Run git to find each; do not reason about the history. Then state the three facts.",
    );
    t.succeeded();
    t.calledSubagent("agent", { count: 0 });
    t.maxToolCalls(6);
  },
});

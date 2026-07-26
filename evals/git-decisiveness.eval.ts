import { defineEval } from "eve/evals";








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

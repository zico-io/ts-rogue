import { defineEval } from "eve/evals";

export default defineEval({
  description: "a git-state question is answered from repository evidence",
  async test(t) {
    await t.send(
      "Using git in this repository, report the current branch, whether the working tree is clean, and how many commits HEAD is ahead of main.",
    );
    t.succeeded();
    t.calledSubagent("agent", { count: 0 });
  },
});

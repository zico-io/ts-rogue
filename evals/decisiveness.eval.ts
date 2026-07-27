import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "a trivial mechanical task is handled directly without mandatory delegation",
  async test(t) {
    await t.send(
      "Make the trivial one-line mechanical fix directly and report the result.",
    );
    t.succeeded();
    t.calledSubagent("agent", { count: 0 });
  },
});

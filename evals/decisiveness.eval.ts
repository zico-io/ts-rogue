import { defineEval } from "eve/evals";










export default defineEval({
  description:
    "a trivial mechanical task is resolved directly, without thrashing or delegating",
  async test(t) {
    await t.send(
      "Make the trivial one-line mechanical fix directly and report it. Do not open an investigation and do not delegate.",
    );
    t.succeeded();
    t.calledSubagent("agent", { count: 0 });
    t.maxToolCalls(10);
  },
});

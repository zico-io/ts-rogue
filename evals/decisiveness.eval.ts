import { defineEval } from "eve/evals";

// Regression guard for the thrashing this harness was tightened to remove: a
// small mechanical task must be resolved decisively and directly, not turned
// into an investigation or delegated to a child.
//
// It bounds both thrash modes and the rumination that motivated the fix:
// - `succeeded()`    - the turn actually completes instead of deliberating to a
//                      timeout (the transcript never acted at all).
// - `calledSubagent(count: 0)` - trivial work is done directly, not delegated.
// - `maxToolCalls`   - no fan-out of redundant, second-guessing tool calls.
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

import { defineHook } from "eve/hooks";

// eve creates the session sandbox lazily, on the first sandbox-touching tool
// call - which lands mid-orientation, so the model sits through the full cold
// start (template restore + onSession's repo sync) before it can read
// ORIENTATION.md, and the delegated coding children it batches afterwards
// inherit that wait too. Kick the same memoized creation at turn start
// instead: it runs concurrently with the model's first inference, and every
// later sandbox use (tool calls, the coding children - built-in `agent`
// children share the root's sandbox) awaits the already-in-flight handle
// rather than starting the cold path from zero. On later turns the sandbox
// already exists, so this is just an early reconnect/resume kick.
//
// The call must stay fire-and-forget: hook handlers run in the turn's emit
// path, and awaiting creation here would stall the turn instead of
// overlapping it.
export default defineHook({
  events: {
    "turn.started"(_event, ctx) {
      try {
        void ctx.getSandbox().catch(() => {
          // Best-effort: a failed prewarm leaves the lazy path in place.
        });
      } catch {
        // No sandbox runtime in this context - the lazy path still applies.
      }
    },
  },
});

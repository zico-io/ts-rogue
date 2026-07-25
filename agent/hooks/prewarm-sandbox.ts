import { defineHook } from "eve/hooks";

import { mintFreshPolicy } from "../sandbox";

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
// Once the handle resolves, re-mint the GitHub auth header and re-install it.
// This is the durable half of token refresh: keepTokenFresh's in-process
// timer chain neither survives harness process recycling between turns nor
// can it mint once its invocation's Vercel OIDC token has expired (the
// production OIDC "refresh" path only works in local dev). A turn is a fresh
// invocation with a fresh OIDC token, so a turn-start re-mint always
// succeeds while the token service is healthy - and recovers push auth that
// the background loop lost, instead of waiting on a timer that may never
// fire.
//
// The call must stay fire-and-forget: hook handlers run in the turn's emit
// path, and awaiting creation here would stall the turn instead of
// overlapping it.
export default defineHook({
  events: {
    "turn.started"(_event, ctx) {
      try {
        void ctx
          .getSandbox()
          .then(async (sandbox) => {
            await sandbox.setNetworkPolicy(await mintFreshPolicy());
          })
          .catch(() => {
            // Best-effort: a failed prewarm or re-mint leaves the lazy path
            // and the background refresh loop in place.
          });
      } catch {
        // No sandbox runtime in this context - the lazy path still applies.
      }
    },
  },
});

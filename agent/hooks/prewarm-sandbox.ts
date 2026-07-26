import { defineHook } from "eve/hooks";

import { mintFreshPolicy } from "../sandbox/sandbox";

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
// For the root's interactive turn the call must stay fire-and-forget: hook
// handlers run in the turn's emit path, and awaiting creation here would stall
// the turn instead of overlapping it.
//
// A declared subagent (coder/reviewer/playtester re-export this hook) is
// different: it runs as a task-mode durable step whose invocation suspends at
// each step boundary and resumes in a fresh process, so its background
// keepTokenFresh refresh timer is unref'd and never ticks, and this
// `turn.started` fires at most once for its whole (single) turn. A detached
// re-mint promise can be frozen at a durable-step checkpoint before it
// resolves, leaving the subagent's sandbox on the unauthenticated OPEN policy
// with no later heal - the exact state behind the coder's "could not read
// Username" push outage. So for a subagent, await the re-mint in-band so it
// actually lands before the step checkpoints. mintFreshPolicy is already
// bounded (withTimeout), and getSandbox here is the same handle the first tool
// call would await anyway, so awaiting adds no new wedge risk. This is a
// last-resort heal on top of onSession's (now widened) startup mint; a single
// subagent turn that outlives the GitHub token TTL (~1h) still has no mid-turn
// heal (rare now that the coder no longer crash-loops - see agent/agent.ts and
// the coder's `reasoning: "none"`).
export default defineHook({
  events: {
    async "turn.started"(_event, ctx) {
      let remint: Promise<void>;
      try {
        remint = ctx.getSandbox().then(async (sandbox) => {
          await sandbox.setNetworkPolicy(await mintFreshPolicy());
        });
      } catch {
        // No sandbox runtime in this context - the lazy path still applies.
        return;
      }
      if (ctx.session.parent != null) {
        // Task-mode subagent: await so the re-mint completes in-band.
        try {
          await remint;
        } catch {
          // Best-effort: a failed re-mint leaves onSession's policy and the
          // background loop in place.
        }
        return;
      }
      // Root interactive turn: detached so the re-mint overlaps first inference.
      void remint.catch(() => {});
    },
  },
});

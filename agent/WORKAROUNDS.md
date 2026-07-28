# Eve framework workarounds

This ledger tracks custom behavior that can be deleted when Eve exposes an
equivalent public capability. Recheck every row when upgrading Eve.

| Capability | Implementation | Framework gap |
| --- | --- | --- |
| Immediate Linear steering and stop | `channels/linear.ts` route wrapper | `linearChannel`'s route does not expose `cancel()` or handle the human `stop` signal, and `onAgentSession` cannot reach `cancel` |
| Re-verifying the Linear webhook ahead of eve's handler | `lib/linear/webhook.ts` | `verifyLinearRequest` is not exported, so the wrapper above cannot reuse eve's own verification for the decision it makes first |
| GitHub inline-review wake-up | `lib/github/wake-policy.ts` | Providing `onComment` replaces the built-in mention gate, whose helpers are not exported |
| Coarse `pull_request_review` verdicts (HAR-49) | `channels/github.ts`, `lib/github/` | `githubChannel` never dispatches on the `pull_request_review` webhook event, so a bare approve/request-changes is dropped |
| Fresh-session handoff | `tools/handoff.ts` | Token-quota continuation is not overridable and Linear comment creation is not public |
| Per-phase context rotation via checkpoint comments | `lib/linear/checkpoint.ts`, `channels/linear.ts`, `tools/handoff.ts` | `linearChannel`'s dispatch hardcodes `linearContinuationToken(agentSession.id)`, so a channel cannot key a fresh context window itself; rotation has to go through `reset` from the route |
| GitHub token refresh | `lib/sandbox/` | Brokered tokens expire mid-session and eve does not re-mint the network policy |
| Vercel traces and sandbox inspection | `connections/vercel-api.ts` | The Vercel MCP server does not expose every required read operation |
| Linear Agent Session activities | `channels/linear.ts`, `lib/agent-plan.ts`, `tools/handoff.ts` | The Linear MCP connection does not expose Agent Session mutations |
| Linear workflow-state synchronization | `lib/linear/issue-state.ts`, channel adapters | Linear Agent Sessions do not update issue workflow state |

## Upgrade check

For each new Eve version:

1. Read the bundled changelog and relevant docs from `node_modules/eve`.
2. Check removed or renamed APIs used by this repository.
3. Compare new public capabilities with every row above.
4. File a Harness issue for each workaround that can be retired.
5. Keep dependency bumps mechanical; adopt new features separately.

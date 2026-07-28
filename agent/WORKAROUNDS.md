# Eve framework workarounds

This ledger tracks custom behavior that can be deleted when Eve exposes an
equivalent public capability. Recheck every row when upgrading Eve.

| Capability | Implementation | Framework gap |
| --- | --- | --- |
| Immediate Linear steering and stop | `channels/linear.ts`, `lib/linear/session.ts` | The built-in Linear route does not expose `cancel()` or handle the human `stop` signal |
| Linear webhook, image, and default-event parity in the custom route | `channels/linear.ts`, `lib/linear/`, `lib/session.ts`, `lib/webhook.ts`, `lib/turn-report.ts` | Required built-in helpers are not exported |
| GitHub inline-review wake-up | `lib/github/wake-policy.ts` | Providing `onComment` replaces the built-in mention gate, whose helpers are not exported |
| Coarse `pull_request_review` verdicts (HAR-49) | `channels/github.ts`, `lib/github/` | `githubChannel` never dispatches on the `pull_request_review` webhook event, so a bare approve/request-changes is dropped |
| Fresh-session handoff | `tools/handoff.ts` | Token-quota continuation is not overridable and Linear comment creation is not public |
| Eager sandbox prewarm and GitHub token refresh | `hooks/prewarm-sandbox.ts`, `lib/sandbox/` | Sandbox creation is lazy and in-process refresh timers do not survive runtime recycling |
| Vercel traces and sandbox inspection | `connections/vercel-api.ts` | The Vercel MCP server does not expose every required read operation |
| Linear Agent Session activities | `channels/linear.ts`, `lib/agent-plan.ts`, `tools/session_update.ts`, `tools/handoff.ts` | The Linear MCP connection does not expose Agent Session mutations |
| Linear workflow-state synchronization | `lib/linear/issue-state.ts`, channel adapters | Linear Agent Sessions do not update issue workflow state |

## Upgrade check

For each new Eve version:

1. Read the bundled changelog and relevant docs from `node_modules/eve`.
2. Check removed or renamed APIs used by this repository.
3. Compare new public capabilities with every row above.
4. File a Harness issue for each workaround that can be retired.
5. Keep dependency bumps mechanical; adopt new features separately.

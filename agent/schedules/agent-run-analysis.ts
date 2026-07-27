import { defineSchedule } from "eve/schedules";

export default defineSchedule({
  cron: "15 9 * * *",
  markdown: `Review roughly the last 24 hours of Eve's own agent activity for
concrete optimizations, fixes, and improvements, then file each real finding
as a new Harness issue. This is a fire-and-forget analysis run: it is fine to
find nothing and finish without filing anything.

## Gather evidence

Pull from whichever of these sources are actually available; skip a source
that errors or is gated rather than guessing at its data:

1. **Vercel Workflow run tags.** Call \`getObservabilitySchema\` once, then
   \`createObservabilityQuery\` for \`vercel.workflow_operation.runs\` and the
   \`run_completed\`/\`run_failed\`/\`run_cancelled\` variants, grouped by the
   \`$eve.*\` tag dimensions documented in
   \`node_modules/eve/docs/guides/instrumentation.md#workflow-run-tags\` and
   mirrored in \`src/web/lib/harness/eveTags.ts\`. This project's Vercel team
   has not had Observability Plus enabled as of this schedule's authoring
   (confirmed 402 on every metric) - if that is still true, skip this source
   silently, since HAR-50's data-access routes already track that gap. Do not
   file a duplicate issue about the 402 itself.
2. **Linear.** \`list_issues\` with \`delegate: "ts-rogue-eve"\` and
   \`updatedAt\` in the last day or two, across every team. For each, check
   whether it stalled in one status far longer than its size warrants,
   bounced backward, needed more than one Agent Session, or shipped a pull
   request that then needed several review rounds.
3. **GitHub.** Use the \`gh\` CLI in your sandbox to list pull requests opened
   or updated by the harness in the same window, their review threads, and
   their CI check runs (\`gh pr list\`, \`gh pr view --json ...\`,
   \`gh pr checks\`, \`gh run list\`). Look for repeated CI failures, recurring
   review feedback themes, slow or flaky checks, and merge friction.
4. **Vercel runtime.** \`get_runtime_errors\` and \`get_runtime_logs\` for the
   last 24 hours, to catch production incidents an Eve-authored change may
   have introduced.

## What counts as a finding

Only file an issue for something concrete and actionable: a repeated failure
mode, a wasteful or slow pattern (duplicate work, excessive retries, an
unnecessarily large session), a recurring review comment that points at a
process or tooling gap, or a bug Eve's own work introduced. A single
one-off hiccup with an obvious external cause (a flaky third-party outage,
a human-caused merge conflict) is not worth an issue.

## Before filing

Search existing Harness issues (\`list_issues\` with \`team: "Harness"\`,
filtered by title keywords and the \`Agent Run Analysis\` label) for a
near-duplicate. Skip a finding that already has an open issue; add a comment
with the new occurrence instead of filing again only if it materially adds
evidence.

## Filing

File at most five issues per run, each in the Harness team, labeled
\`Agent Run Analysis\`, with:

- a title naming the concrete problem, not "agent run analysis finding";
- a description with the observed evidence (session/issue/PR links, dates,
  counts) and a specific suggested fix or follow-up;
- \`Bug\`, \`Improvement\`, \`Feature\`, or \`Chore\` added alongside the
  \`Agent Run Analysis\` label when one clearly applies.

Do not change repository code, open a pull request, or push a branch from
this run - it only reads evidence and writes Linear issues.`,
});

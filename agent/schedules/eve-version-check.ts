import { defineSchedule } from "eve/schedules";

// Daily eve dependency check (task mode: fire-and-forget, no Linear Agent
// Session, cannot park - see node_modules/eve/docs/schedules.mdx). The prompt
// is the whole procedure; agent/README.md's "Workaround audit" table is the
// evaluation checklist it cites. Vercel evaluates cron in UTC.
export default defineSchedule({
  cron: "0 8 * * *",
  markdown: `Scheduled maintenance turn: keep this repo's eve dependency current.

There is no Linear Agent Session. Skip orientation, sizing, delegation, and
session_update entirely. You cannot wait for input: finish or stop.

1. Gate. In one batch run \`npm view eve version\`, read the \`eve\` version
   from the \`catalog\` block in \`pnpm-workspace.yaml\` (the single source of
   truth both \`package.json\` and \`src/web/package.json\` reference as
   \`catalog:\`), and run
   \`gh pr list --state open --json number,title,headRefName\`. If the
   published version equals the catalog range's version, or any open PR's
   \`headRefName\` starts with \`eve-bump-\`, stop with no output.

2. Bump, then read. Create branch \`eve-bump-<new-version>\` off \`main\`.
   Update \`catalog.eve\` in \`pnpm-workspace.yaml\` to \`^<new-version>\` and
   run \`pnpm install\` - this moves the root and \`src/web\` together, since
   both resolve eve through the catalog; keeping them on one version matters
   because \`src/web\` is what builds the agent as a nested Vercel service.
   Resolve any peer-range warnings it prints (eve's peer ranges can force
   bumps of \`ai\` and similar). Only after the install, read
   \`node_modules/eve/CHANGELOG.md\` - it only ever contains the installed
   version's entries - and collect every entry strictly newer than the
   previous version.

3. Evaluate. Judge each entry on two axes: (a) breaking or removed APIs this
   repo calls (grep before assuming), and (b) features that could retire a
   hand-rolled workaround - check each row of the "Workaround audit" table in
   \`agent/README.md\`. Do not perform feature-adoption refactors in this
   turn; file each one as a Linear issue on the HAR team via \`save_issue\`
   with the changelog evidence.

4. Policy. If only the patch version moved, proceed. If the minor version
   moved, first create a Linear issue on the HAR team containing the
   evaluation writeup (changelog summary, breaking-change assessment, per-row
   audit verdicts), then proceed with the mechanical bump only.

5. Ship. Migrate any removed or renamed APIs the repo actually uses. The gate
   is \`pnpm typecheck && pnpm lint && pnpm test && npx eve info\` - all four
   green. Commit, push the branch, and open a PR against \`main\` whose body
   carries the changelog summary and the audit verdicts.

6. Failure. If the gate cannot be made green with mechanical migration, do
   not open a PR. Create a Linear issue on the HAR team with the failing
   output and what you tried, then stop.`,
});

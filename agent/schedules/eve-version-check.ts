import { defineSchedule } from "eve/schedules";

export default defineSchedule({
  cron: "0 8 * * *",
  markdown: `Check whether the repository's Eve dependency needs an update.

Compare the published Eve version with the catalog entry in
\`pnpm-workspace.yaml\` and skip when they match or an \`eve-bump-\` pull request
is already open.

For an update:

1. Create \`eve-bump-<version>\` from \`main\`, update the catalog, and run
   \`pnpm install\`.
2. Read the installed \`node_modules/eve/CHANGELOG.md\` entries newer than the
   previous version. Check for breaking API changes and compare new capabilities
   with every row in \`agent/WORKAROUNDS.md\`.
3. File a Harness issue for each workaround that can be retired. For a minor
   version update, also file one Harness issue containing the compatibility
   assessment.
4. Make only migrations required by removed or renamed APIs. Verify with
   \`pnpm typecheck && pnpm lint && pnpm test && pnpm exec eve info\`.
5. Commit, push, and open a pull request with the changelog summary and
   workaround verdicts.

If a mechanical migration cannot pass the gate, file a Harness issue with the
failure and stop without opening a pull request.`,
});

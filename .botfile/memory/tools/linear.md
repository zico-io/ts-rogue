# Linear and GitHub

- Linear is the source of truth for work status and priority. <source: repository scaffolding request, 2026-07-19>
- Git and GitHub provide branching, commits, pull-request review, merge, and release history. <source: repository scaffolding request, 2026-07-19>
- Pull requests carry the Linear issue identifier and use the Linear-suggested branch name when available. <source: CONTRIBUTING.md, 2026-07-19>
- Durable product truth lives in the repository rather than in issue descriptions. <source: CONTRIBUTING.md, 2026-07-19>
- A `.githooks/pre-push` hook warns (non-blocking) when a push lacks a `ROG-<n>` reference in the branch name or commit messages; it is wired via the `prepare` script setting `core.hooksPath`. Enforcement is a warning by choice, not a hard CI gate. <source: harness hardening request, 2026-07-19>
- The Linear MCP server (`https://mcp.linear.app/mcp`, streamable HTTP) is configured project-scoped in `.mcp.json`; auth is per-user OAuth via `/mcp`. <source: https://linear.app/docs/mcp, 2026-07-19>
- Headless auth strategy: interactive humans use OAuth via `/mcp`; spawned workers never hold Linear creds, the L1 orchestrator files issues for them via `spawn.py bridge-issue <feature> <bug|feature|chore> <title> [desc]` (env `LINEAR_API_KEY` bot key + `LINEAR_TEAM_KEY`), mirroring `bridge-pr`; the label is resolved/auto-created in the team. CI/cron use the same bot key on the GraphQL API. <source: orchestrator wiring, 2026-07-19>


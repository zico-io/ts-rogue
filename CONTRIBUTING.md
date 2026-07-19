# Contributing

## Workflow

1. Start with an assigned Linear issue and confirm its acceptance criteria against `PROJECT_PLAN.md`.
2. Create a branch using Linear's suggested name when available.
3. Implement the smallest complete vertical change.
4. Update `docs/product.md` when shipped behavior, commands, requirements, or repository layout changes.
5. Run `pnpm check`.
6. Open a GitHub pull request and include the Linear issue identifier.

A `pre-push` hook (wired automatically on `pnpm install`) warns, without blocking, when a push has no Linear issue reference in the branch name or commit messages.

The Linear MCP server is configured in `.mcp.json`. Run `/mcp` in Claude Code to authenticate (OAuth, per user) before creating or querying Linear issues from a session.

Keep roadmap discussion and task status in Linear. Keep durable product truth in the repository.


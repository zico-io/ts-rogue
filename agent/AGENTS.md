# Eve agent instructions

- Keep runtime behavior aligned with `instructions.md`.
- Treat Linear as the source of truth and GitHub pull requests as the merge boundary.
- Keep credentials in Vercel Connect and sandbox network policies, never prompts, logs, or files.
- Keep orientation pre-computed: `instructions.md` carries the standing rules, and `onSession` writes the `ORIENTATION.md` brief so the root reads settled state instead of rediscovering it. Do not reintroduce runtime "read AGENTS.md / memory / PROJECT_PLAN" orientation directives.
- Preserve single-child delegation for ordinary work.
- Report progress through native Agent Session activities, not issue comments.
- Keep startup useful when GitHub token minting fails and retry refreshes without blocking sessions.
- Test channel transforms, hooks, tools, model routing, and sandbox lifecycle changes.
- Update `README.md` when the agent architecture or development workflow changes.

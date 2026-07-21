# Eve agent instructions

- Keep runtime behavior aligned with `instructions.md`.
- Treat Linear as the source of truth and GitHub pull requests as the merge boundary.
- Keep credentials in Vercel Connect and sandbox network policies, never prompts, logs, or files.
- Preserve bounded root orientation and single-child delegation for ordinary work.
- Report progress through native Agent Session activities, not issue comments.
- Keep startup useful when GitHub token minting fails and retry refreshes without blocking sessions.
- Test channel transforms, hooks, tools, model routing, and sandbox lifecycle changes.
- Update `README.md` when the agent architecture or development workflow changes.

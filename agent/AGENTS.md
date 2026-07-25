# Eve agent instructions

- Keep runtime behavior aligned with `instructions.md`.
- Treat Linear as the source of truth and GitHub pull requests as the merge boundary.
- Keep credentials in Vercel Connect and sandbox network policies, never prompts, logs, or files.
- Keep orientation pre-computed: `instructions.md` carries the standing rules, and `onSession` writes the `ORIENTATION.md` brief so the root reads settled state instead of rediscovering it. Do not reintroduce runtime "read AGENTS.md / memory / PROJECT_PLAN" orientation directives.
- Preserve single-child delegation for ordinary work. Parallel children exist for one case only: an issue group's ready workstreams (created from a human-approved breakdown or pre-existing sub-issues), each in its own git worktree with a non-overlapping write scope, batched in one turn.
- Keep the sizing gate a judgment over the issue packet, never a new orientation read, and keep the approval pause on the runtime's `ask_question` park rather than prompt-enforced stopping.
- Preserve `instructions.md`'s early `session_update` and tool-call-batching rules: the root must post a durable message before its first other tool call and batch independent read-only lookups into one turn, so a multi-call orientation is never silent noise in Linear.
- Eve's messages describe the work and its status, never the contract's own mechanics (orientation lookups, sub-issue checks, delegation, batching, `pnpm check`). Those sentences surface to the reader verbatim, so keep the message rules as terse imperatives and hold design rationale in `README.md`, not the runtime prompt - reintroducing parrotable meta-language next to a message rule is how process text leaks into user-facing updates. Guarded by `evals/message-substance.eval.ts`.
- Treat `.botfile/memory/domain/product.md` as the golden product SSOT: upsert it in the same PR when shipped behavior changes, and keep it clean under `pnpm docs:lint`.
- Report progress through native Agent Session activities, not issue comments.
- Keep startup useful when GitHub token minting fails and retry refreshes without blocking sessions.
- Test channel transforms, hooks, tools, model routing, and sandbox lifecycle changes.
- Update `README.md` when the agent architecture or development workflow changes.

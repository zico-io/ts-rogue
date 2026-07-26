# Eve agent instructions

- Keep standing behavior short in `instructions.md`; put optional procedures in
  skills and enforce security or lifecycle invariants in code.
- Preserve Linear steering, session lifecycle, issue-group handoff, Git recovery,
  credential brokering, pull-request review, and end-to-end evidence.
- Prefer root-first delivery. Add a subagent only for a distinct role, narrower
  capability surface, or useful isolation.
- Keep Linear as the issue source of truth and GitHub pull requests as the merge
  boundary.
- Keep credentials in Vercel Connect and sandbox network policies.
- Keep issue workflow transitions forward-only and fail-open in
  `lib/issue-state.ts`.
- Keep sandbox prewarm and token refresh failures from blocking useful startup.
- Test channel transforms, hooks, tools, lifecycle changes, and sandbox behavior.
- Keep `README.md` evergreen and update it when the architecture or workflow
  changes.

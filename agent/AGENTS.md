# Eve agent instructions

- Keep standing behavior short in `instructions.md`; put optional procedures in
  skills and enforce security or lifecycle invariants in code.
- Preserve Linear steering, session lifecycle, issue-group handoff, Git recovery,
  credential brokering, pull-request review, and end-to-end evidence.
- Prefer root-first delivery. Add a subagent only for a distinct role, narrower
  capability surface, or useful isolation.
- Keep Linear as the issue source of truth and GitHub pull requests as the merge
  boundary.
- Keep human-facing prose concise and headerless. Linear and GitHub metadata
  already provide titles, identities, and state.
- Keep credentials in Vercel Connect and sandbox network policies.
- Treat Linear's Agent Interaction Guidelines as acceptance criteria for
  harness changes: disclose the agent, use native platform actions, respond
  promptly, expose meaningful state, honor disengagement, and keep a human
  accountable.
- Keep issue workflow transitions forward-only and fail-open in
  `lib/linear/issue-state.ts`.
- Keep token refresh failures from blocking useful startup.
- Keep `lib/` modules channel-agnostic when they are flat. A module that names
  one platform, or imports one platform's types, belongs in `lib/linear/` or
  `lib/github/` - directory names the channel, file names the concept. Platform
  limits (message length, activity size) belong to whoever posts: a channel
  renderer or a hook, never a shared module. Import those modules directly;
  they carry no barrel, so a caller loads only what it names.
- Add a channel as one file under `channels/`: a `ChannelRenderer` from
  `lib/channel.ts` (`textRenderer` already covers any channel whose only
  surface is posted text), wired with `sessionEvents` from `lib/session.ts`.
  Spread that table and set a key to `undefined` to keep Eve's own default for
  an event. Reaching a session from outside a handler - workflow progress, say
  - needs a poster like `lib/linear/poster.ts`, dispatched on the channel kind
  by the caller and imported lazily so one channel's credentials never reach
  another's process.
- Test channel transforms, hooks, tools, lifecycle changes, and sandbox behavior.
- Colocate tests inside `lib/` only. Eve's discovery treats every file under
  `channels/`, `connections/`, `tools/`, `hooks/`, and `schedules/` as an
  authored module, so a `*.test.ts` there fails `eve info` with a name-invalid
  error; those tests live in `src/`. `lib/` likewise accepts no non-TypeScript
  files, which is why this rule is here and not in a `lib/AGENTS.md`.
- Keep `README.md` evergreen and update it when the architecture or workflow
  changes.

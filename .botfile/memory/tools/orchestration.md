# Orchestration

- Multi-agent missions use herdr for process placement and orbal-net rooms for coordination. <source: AGENTS.md orchestration protocol, 2026-07-19>
- Missions have at most three layers: one orchestrator, leads, and leaf workers. <source: AGENTS.md orchestration protocol, 2026-07-19>
- The orchestrator communicates with leads in `mission-<feature>`; each lead communicates with its workers in `squad-<lead>`. <source: AGENTS.md orchestration protocol, 2026-07-19>
- Use non-consuming `orbal-net peek` or the TUI to monitor messages, and use push-backed `orbal-net recv` to wait for work. <source: AGENTS.md orchestration protocol, 2026-07-19>
- The orchestrator owns networked GitHub operations because spawned agents use a local mirror and lack network access. <source: AGENTS.md orchestration protocol, 2026-07-19>
- `orchestration/spawn.py` delegates to the portable harness under `BOTFILES_HOME`, which defaults to `~/.botfiles`. <source: orchestration/spawn.py, 2026-07-19>
- Eve is the always-on L1 entrypoint for project development; Linear Agent Sessions receive work and Linear remains the source of truth for delegation and status. <source: project owner request, 2026-07-19>
- Eve is deployed through the Vercel project `bob-v0`; Linear Agent Session traffic uses `linear/ts-rogue-eve` at `/eve/v1/linear`, and issue operations use `mcp.linear.app/ts-rogue-eve-mcp`. <source: Vercel project and Connect configuration, 2026-07-19>
- Eve pre-warms a Vercel Sandbox template with `zico-io/ts-rogue` and its pnpm dependencies; each session inherits that filesystem and receives firewall-brokered GitHub credentials from `github/ts-rogue-eve-github`, so the token never enters the sandbox. <source: Eve sandbox configuration, 2026-07-19>

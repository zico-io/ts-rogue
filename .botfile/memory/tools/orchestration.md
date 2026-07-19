# Orchestration

- Multi-agent missions use herdr for process placement and orbal-net rooms for coordination. <source: AGENTS.md orchestration protocol, 2026-07-19>
- Missions have at most three layers: one orchestrator, leads, and leaf workers. <source: AGENTS.md orchestration protocol, 2026-07-19>
- The orchestrator communicates with leads in `mission-<feature>`; each lead communicates with its workers in `squad-<lead>`. <source: AGENTS.md orchestration protocol, 2026-07-19>
- Use non-consuming `orbal-net peek` or the TUI to monitor messages, and use push-backed `orbal-net recv` to wait for work. <source: AGENTS.md orchestration protocol, 2026-07-19>
- The orchestrator owns networked GitHub operations because spawned agents use a local mirror and lack network access. <source: AGENTS.md orchestration protocol, 2026-07-19>
- `orchestration/spawn.py` delegates to the portable harness under `BOTFILES_HOME`, which defaults to `~/.botfiles`. <source: orchestration/spawn.py, 2026-07-19>

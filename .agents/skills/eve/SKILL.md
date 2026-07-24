---
name: eve
description: Build durable backend AI agents with the eve framework. Use when creating, editing, or debugging an eve project — agent instructions, skills, tools, connections, channels, sandboxes, subagents, schedules, or evals.
---

# eve

eve is a filesystem-first framework for durable backend AI agents. An agent is
a directory on disk — instructions, skills, tools, connections, channels,
subagents, and schedules are all files — and eve compiles and runs it.

## Source of truth

When you are editing the eve harness itself (agent instructions, skills, tools,
connections, channels, sandbox, subagents, schedules, or evals), read the bundled
docs, which match the installed version exactly:

```
node_modules/eve/docs/
```

Start with `node_modules/eve/docs/README.md` for the index and reading order, then
read the relevant guide before writing eve code. This is for harness work only; an
ordinary product task does not need the framework docs.

If `eve` is not installed yet, install it (`npm install eve`) or scaffold a new
agent with `npx eve init <agent-name>`, then read the bundled docs.

# Eve project agent

The Eve agent receives ts-rogue work through Linear and runs repository tasks in
pre-warmed Vercel Sandboxes.

## Components

| Path | Responsibility |
| --- | --- |
| [`agent.ts`](agent.ts) | Root and delegated coding model selection |
| [`instructions.md`](instructions.md) | Runtime operating and delegation contract |
| [`channels/`](channels/) | Eve, Linear, and GitHub session activity adapters |
| [`connections/`](connections/) | Linear MCP connection and approval policy |
| [`hooks/`](hooks/) | Delegated-child activity relay |
| [`tools/`](tools/) | Native Linear Agent Session progress updates |
| [`sandbox.ts`](sandbox.ts) | Vercel Sandbox bootstrap, sync, and the credential-broker network policy |
| [`proxy.ts`](proxy.ts) | `forwardURL` broker: dispatches on host, mints a fresh credential per request, and injects it at the firewall |

Linear owns issue status, priority, and progress. GitHub pull requests remain the
review and merge boundary. GitHub credentials are injected through the sandbox
network policy rather than exposed to the agent environment.

The root agent performs bounded orientation, delegates ordinary implementation
to one coding child, and retains review and external coordination. Agent Session
activities carry progress and approval prompts without writing issue comments.

## Development

Run the local agent with:

```bash
pnpm eve:dev
```

Agent integrations and sandbox behavior are covered by the root-level Vitest
suite. Run `pnpm test:unit` or the complete `pnpm check` before handoff.

Repository workflow and requirements live in the [root README](../README.md).

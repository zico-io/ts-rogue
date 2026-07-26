# Before / After: Applying README Hygiene

A worked example showing the standard applied to a cluttered README. Use as a model for the level and style of cleanup.

---

## BEFORE (cluttered, time-anchored, historical)

```md
# Payments Service

Welcome! This is our brand-new payments service, recently rewritten in 2025
to replace the old Ruby version. We're really excited about it.

## What's New
- v2.3 (June 2026): Added Stripe webhooks 🎉
- v2.2: Migrated from `npm` to `pnpm`
- v2.1: New retry logic (coming soon: idempotency keys!)
- v2.0: Full rewrite

## Migrating from v1
If you're upgrading from the old Ruby service, first export your keys with
`rake payments:export`, then... [30 lines of migration steps] ...

## Setup
Run `npm install` and then `npm start`. (Note: we now use pnpm, so actually
run `pnpm install`.) You'll need Node - we're currently on 18 but planning
to move to 20 soon.

## Roadmap
- [ ] Idempotency keys
- [ ] Multi-currency (planned Q4)
- [x] Webhooks (done!)
- [ ] TODO: figure out refund edge case

## Config
Set STRIPE_KEY=sk_test_abc123 in your environment.
```

### Problems flagged

**Broken**
- `npm install` / `npm start` contradict the real `pnpm` manager.
- Node "18" is wrong - `.nvmrc` says 20.
- Hardcoded secret value `sk_test_abc123`.

**Stale/clutter**
- "brand-new", "recently", "really excited", "coming soon", "currently", "soon", "planning to".
- Entire "What's New" changelog → belongs in `CHANGELOG.md`.
- "Migrating from v1" walkthrough → belongs in `MIGRATING.md`.
- "Roadmap" section (planned + a resolved item + a TODO) → belongs in issues; the done item is just noise.

**Missing**
- No clear one-line description, no requirements block, no pointer to `.env.example`, contributing, or license.

---

## AFTER (evergreen, current-state, concise)

```md
# Payments Service

Processes card payments and Stripe webhooks for the platform.

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in required values
pnpm dev
```

Service runs at `http://localhost:4000`.

## Requirements
- Node 20 (`nvm use`)
- pnpm 9 (`corepack enable`)
- A Stripe account (test keys for local dev)

## Common tasks
| Task | Command |
|------|---------|
| Dev server | `pnpm dev` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |

## Configuration
Copy `.env.example` → `.env.local`. Required keys (`STRIPE_KEY`, `STRIPE_WEBHOOK_SECRET`)
are documented there. Never commit secrets.

## More
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Version history: [CHANGELOG.md](./CHANGELOG.md)
- Upgrading from v1: [MIGRATING.md](./MIGRATING.md)
- License: MIT
```

### What was relocated

| Removed from README | Sent to |
|---|---|
| "What's New" version log | `CHANGELOG.md` |
| v1 migration steps | `MIGRATING.md` |
| Roadmap / planned features | Issues / project board |
| Resolved webhook item, refund TODO | Deleted (roadmap noise / tracked in issues) |
| Hardcoded `STRIPE_KEY` value | Replaced with a pointer to `.env.example` |

The result reads correctly no matter when someone opens it, and every command and version is verifiable against the repo.

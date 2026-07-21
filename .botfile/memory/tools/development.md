# Development

- Node.js 24+ and pnpm 10+ are repository requirements; pnpm is pinned to 11.7.0 via `packageManager`. <source: package.json, 2026-07-19>
- `pnpm check` runs every implemented repository check. <source: package.json, 2026-07-19>
- `pnpm changeset` records release-facing changes; documentation, tests, and internal refactors do not require a changeset. <source: package.json and .changeset/README.md, 2026-07-20>
- GitHub Actions runs repository checks on main, pull requests, a weekly schedule, and manual dispatch. <source: .github/workflows/quality.yml, 2026-07-19>

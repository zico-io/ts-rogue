# Development

- Node.js 20+ and pnpm 10+ are repository requirements. <source: package.json, 2026-07-19>
- `pnpm check` runs every implemented repository check. <source: package.json, 2026-07-19>
- `pnpm docs:check` validates local Markdown links and pull-request product documentation coupling. <source: scripts/check-docs.mjs, 2026-07-19>
- GitHub Actions runs repository checks on main, pull requests, a weekly schedule, and manual dispatch. <source: .github/workflows/quality.yml, 2026-07-19>


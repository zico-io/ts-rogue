# README Hygiene Checklist

Run every item during an audit (Mode A). Mark each ✅ pass / ❌ fail / ⚠️ needs verification, with a location and fix for every non-pass.

## 1. Accuracy vs. the code (highest priority — these actively mislead)

- [ ] Every command shown actually exists (cross-check `package.json` scripts / Makefile / task runner).
- [ ] The package manager shown matches the real lockfile (`pnpm-lock.yaml` → `pnpm`, etc.).
- [ ] Runtime/version requirements match `.nvmrc` / `engines` / tool configs.
- [ ] Every file/directory path referenced exists in the repo.
- [ ] Every internal link and anchor resolves; no 404s to moved/renamed files.
- [ ] Every external link resolves and points to the intended, current destination.
- [ ] Environment variables named in the README exist in `.env.example` (and vice versa for required ones).
- [ ] Ports, URLs, and default hosts match the actual dev config.
- [ ] Every feature/capability described is actually shipped in the current code.

## 2. Evergreen language (remove time-anchored content)

- [ ] No time-relative words: new, recently, currently, now, soon, coming, upcoming, as of, at the time of writing.
- [ ] No version-pinned prose ("since v2", "in the latest release", "deprecated in 3.x").
- [ ] No dated announcements or "what's new" blurbs.
- [ ] No aspirational/unshipped features, roadmap, or "planned" work.
- [ ] No TODO / WIP / FIXME / "not yet implemented" markers.
- [ ] Prose is present-tense and declarative, not narrating change over time.

## 3. History & clutter (relocate to the correct home file)

- [ ] No inline changelog / version history → `CHANGELOG.md` or Releases.
- [ ] No migration or upgrade walkthroughs → `MIGRATING.md` / `/docs`.
- [ ] No design rationale / "why we chose X" essays → ADRs in `/docs/adr`.
- [ ] No long API reference or tutorials inline → `/docs`.
- [ ] No resolved TODOs, obsolete caveats, or dead workarounds (delete — they live in git history).
- [ ] No duplicated content that also lives in CONTRIBUTING / SECURITY / docs → link instead.

## 4. Completeness (a newcomer must not be blocked)

- [ ] One-line description of what the project is.
- [ ] Quick start: minimal copy-paste path from clone to running.
- [ ] Requirements clearly listed.
- [ ] A run/dev command that works.
- [ ] Configuration pointer (`.env.example`) if env vars are needed.
- [ ] Pointers to CONTRIBUTING, SECURITY (if applicable), LICENSE.

## 5. Structure & concision

- [ ] "How do I run it" is reachable near the top, before reference material.
- [ ] Tables/short command blocks used instead of long paragraphs where possible.
- [ ] README is a snapshot + pointers, not an encyclopedia; depth pushed to `/docs`.
- [ ] Every fenced code block declares a language identifier (markdownlint MD040) — `text` for directory trees / plain output, `bash`, `ts`, `json`, etc. otherwise.
- [ ] No secret values, tokens, or PHI/PII hardcoded anywhere.

## Severity mapping for the report

- **Broken** = any ❌ in section 1 (wrong commands, dead links, missing paths, unshipped features).
- **Stale/clutter** = any ❌ in sections 2–3 (time-anchored language, history, duplication).
- **Missing** = any ❌ in section 4 (newcomer blockers).
- Section 5 items are **polish** — note but don't over-weight.

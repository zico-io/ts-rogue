---
description: "Enforce evergreen, human-readable README hygiene. Use when the user asks to write, review, audit, clean up, refresh, or maintain a README (or other human-facing docs like CONTRIBUTING) so it reflects the true current state of the project instead of accumulating changelog history, stale commands, roadmap cruft, or aspirational features. Also use to check a README against the code, or to establish rules that keep READMEs concise and current over time. Do NOT use for AGENTS.md / agent-facing instruction files."
---

# README Hygiene

## When to Use This Skill

Use when the user wants to:

- Write a new human-facing README from scratch.
- Review, audit, or clean up an existing README.
- Refresh a README so it matches the current code (commands, layout, requirements).
- Remove clutter: changelog history, migration notes, resolved TODOs, dead links, aspirational/unshipped features.
- Establish a repeatable standard that keeps READMEs evergreen over time.

Do NOT use this for `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or other agent-facing instruction files — those follow different rules (terse, machine-oriented, convention-dumping). READMEs are for humans.

## Core Principle: Evergreen, Not a Diary

A README describes **what is true right now**, written for a human who has never seen the project. It is a snapshot, not a log.

- **Evergreen**: reads correctly regardless of when someone opens it. No "recently", "new!", "as of v2.3", "coming soon", dated announcements, or migration walkthroughs.
- **Current state only**: every command, path, requirement, and feature described must exist in the code *today*. If it is not shipped, it is not in the README.
- **History lives elsewhere**: changelogs → `CHANGELOG.md` or release notes; migration guides → `MIGRATING.md` or `/docs`; roadmap → issues/project board; decisions → ADRs. Link to them; do not inline them.
- **Concise**: the README answers "what is this, how do I run it, where do I go next" — nothing more. Depth belongs in `/docs`.

## The Two Modes

### Mode A — Review / Audit an existing README

1. **Read the README fully.** Also read `package.json` (scripts, engines, name), lockfile / manager, `.nvmrc`, entry points, and the top-level directory tree. The goal is to compare claims against reality.
2. **Verify every factual claim against the code.** For each command, path, port, env var, requirement, and named feature, confirm it exists. Flag anything unverifiable.
3. **Run the hygiene checklist** in `references/hygiene-checklist.md` and produce findings grouped by severity:
   - **Broken** (actively misleads): wrong commands, dead links, referenced files/dirs that don't exist, features described that aren't shipped, wrong install steps.
   - **Stale/clutter** (should be removed or relocated): changelog entries, migration notes, "new/recently/coming soon" language, resolved TODOs, version-pinned prose, duplicated content.
   - **Missing** (a newcomer would be blocked): no quick start, no requirements, no run command, no pointer to contributing/security/license.
4. **Report findings first** with specific line references and the fix for each. Then, if asked (or if the intent was "clean it up"), produce the rewritten README.
5. **Never invent facts.** If a command or requirement can't be confirmed from the repo, mark it `NEEDS VERIFICATION` rather than guessing.

### Mode B — Write / Rewrite a README

1. Gather ground truth from the repo (manager, scripts, engines, layout, entry point, env example). Do not copy claims from an old README without verifying them.
2. Follow the structure in "Evergreen README Structure" below. Include only sections that apply.
3. Keep prose tight. Prefer tables and short command blocks over paragraphs.
4. Strip anything time-relative or historical. Route it to the correct home file and link there.
5. Show a newcomer the shortest path to a running project first (quick start), then reference material.

## Evergreen README Structure

Order matters — a reader should reach "how do I run it" fast. Omit sections that don't apply; do not pad.

1. **Title + one-line description.** What it is, in one sentence. No taglines about how new/modern it is.
2. **(Optional) Status badges.** CI, coverage, license — only if they auto-update. Never hand-written version text.
3. **Quick start.** The minimal copy-paste path from clone to running. This is the most important section.
4. **Requirements.** Runtime versions, package manager, external services (DB, etc.). Pull versions from `.nvmrc` / `engines`.
5. **Repository layout.** A short table of top-level dirs and what each is — only if the structure isn't obvious.
6. **Common tasks / scripts.** A table mapping intent → command, sourced from real `package.json` scripts.
7. **Configuration.** Point to `.env.example`; describe required env vars by name. Never hardcode secret values.
8. **Pointers, not content.** Link out to `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `/docs`, `CHANGELOG.md`. Keep the README from absorbing their content.
9. **License.** One line.

## What Belongs Elsewhere (relocate, don't delete blindly)

| Content found in README | True home |
|---|---|
| Version-by-version changes, "what's new" | `CHANGELOG.md` / GitHub Releases |
| Upgrade / breaking-change walkthroughs | `MIGRATING.md` or `/docs/migration` |
| Roadmap, planned features, "coming soon" | Issues / project board |
| Design rationale, "why we chose X" | ADRs in `/docs/adr` |
| Long API references, tutorials | `/docs` |
| Resolved TODOs / historical caveats | Delete (they're in git history) |
| Contribution/setup rules for devs | `CONTRIBUTING.md` |

When relocating, tell the user where each block should go rather than silently dropping it; only delete outright when the content is truly dead (resolved TODOs, obsolete caveats).

## Language Rules (evergreen enforcement)

Remove or rewrite anything that anchors the doc to a moment in time:

- **Ban time-relative words**: "new", "recently", "currently", "now", "soon", "coming", "upcoming", "as of", "at the time of writing", "will be", "planned".
- **Ban version-pinned prose**: "since v2", "in the latest release", "deprecated in 3.x" (put in changelog).
- **Ban aspirational features**: describe only what runs today. "TODO", "WIP", "not yet implemented" → remove from README.
- **Prefer present tense, declarative**: "The API exposes X." not "We recently added X and plan to expand it."
- **Keep it manager-accurate**: if the repo uses `pnpm`, never show `npm`; match the real lockfile.
- **Tag every fenced code block with a language** (markdownlint MD040): use `text` for directory trees and plain output, and the real language (`bash`, `ts`, `json`, …) otherwise. An untagged ``` ``` ``` fence is a finding.

## Maintenance Guidance (offer when setting up standards)

- Update the README **in the same PR** as any change to commands, layout, requirements, or user-facing behavior. Treat a stale README as a bug.
- Add a PR-template checkbox: "README updated if commands/layout/requirements changed."
- Do a **quarterly evergreen sweep**: re-run Mode A, purge accumulated time-relative language.
- Keep the README short by pushing depth to `/docs` early, before it accretes.

## Output Format

- For audits: findings grouped by **Broken / Stale / Missing**, each with a location and a concrete fix, then the rewritten README (as a fenced ```md block or shared file, per the user's requested delivery).
- For writes: the README as a fenced ```md block or shared file. Note any `NEEDS VERIFICATION` items separately so the user can confirm.
- Always call out what you relocated and where it should live.

## References

- `references/hygiene-checklist.md` — the full pass/fail checklist to run in Mode A. Read before auditing.
- `references/before-after-example.md` — a worked before/after showing clutter removal and relocation. Read when the user wants to see the standard applied or needs a model to follow.

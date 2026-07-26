---
description: "Enforce evergreen, human-readable README hygiene. Use when the user asks to write, review, audit, clean up, refresh, or maintain a README (or other human-facing docs like CONTRIBUTING) so it reflects the true current state of the project instead of accumulating changelog history, stale commands, roadmap cruft, or aspirational features. Also use to check a README against the code, or to establish rules that keep READMEs concise and current over time. Do NOT use for AGENTS.md / agent-facing instruction files."
---

# README Hygiene

Use when the user wants to write, audit, refresh, or declutter a human-facing
README (or docs like `CONTRIBUTING.md`). Do NOT use for `AGENTS.md`,
`CLAUDE.md`, or other agent-facing instruction files - those are terse and
machine-oriented; READMEs are for humans.

## Core principle: evergreen, not a diary

A README describes what is true *right now*, for someone who has never seen the
project. It is a snapshot, not a log.

- Every command, path, requirement, and feature described must exist in the code
  today. If it is not shipped, it is not in the README.
- History lives elsewhere: changelog → `CHANGELOG.md`/Releases; migrations →
  `MIGRATING.md`; roadmap → issues; rationale → ADRs. Link, don't inline.
- Answer "what is this, how do I run it, where do I go next" - nothing more.
  Depth belongs in `/docs`.

## Auditing an existing README

1. Read the README, then `package.json` (scripts, engines), the lockfile,
   `.nvmrc`, entry points, and the top-level tree. Compare claims to reality.
2. Verify every command, path, port, env var, and named feature exists. Mark
   anything you can't confirm `NEEDS VERIFICATION` - never invent facts.
3. Run the checklist below and report findings grouped by severity, each with a
   location and concrete fix. Then produce the rewrite if that was the intent.

Severity: **Broken** = actively misleading (wrong commands, dead links, missing
paths, unshipped features). **Stale** = time-anchored language, inline history,
duplication - remove or relocate. **Missing** = a newcomer is blocked (no quick
start, requirements, run command, or pointers).

## Writing / rewriting

Gather ground truth from the repo first; don't copy an old README's claims
without checking. Lead with the shortest path to a running project, then
reference material. Prefer tables and short command blocks over paragraphs.
Include only the sections that apply, roughly in this order: title + one-line
description, quick start, requirements (from `.nvmrc`/`engines`), repo layout
(only if non-obvious), common tasks (from real scripts), configuration (point to
`.env.example`, name required vars, never hardcode secrets), pointers
(`CONTRIBUTING`, `SECURITY`, `LICENSE`, `/docs`), license.

## Checklist

**Accuracy** (fail = Broken):
- Commands match real `package.json` scripts; package manager matches the lockfile.
- Runtime/version requirements match `.nvmrc`/`engines`.
- Every referenced path, internal link, and external link resolves.
- Env vars named match `.env.example`; ports/URLs match the dev config.
- Every feature described is actually shipped.

**Evergreen** (fail = Stale):
- No time-relative words (new, recently, now, soon, coming, as of).
- No version-pinned prose ("since v2", "in the latest release").
- No dated announcements, roadmap, aspirational/unshipped features, or TODO/WIP markers.
- Prose is present-tense and declarative.

**History & clutter** (fail = Stale):
- No inline changelog, migration walkthroughs, rationale essays, or long API docs -
  relocate to the correct home file and link.
- No resolved TODOs or dead caveats (delete; they live in git history).
- No content duplicated from CONTRIBUTING/SECURITY/docs - link instead.

**Completeness** (fail = Missing):
- One-line description, quick start, requirements, a working run command.
- Configuration pointer if env vars are needed; pointers to CONTRIBUTING/SECURITY/LICENSE.

**Polish** (note, don't over-weight):
- "How do I run it" is near the top.
- Every fenced code block declares a language (markdownlint MD040): `text` for
  trees/plain output, real language otherwise.
- No secrets, tokens, or PII hardcoded anywhere.

## Output

Audits: findings grouped Broken / Stale / Missing, then the rewrite (fenced
```md block or shared file). Always call out what you relocated and where it
should live.

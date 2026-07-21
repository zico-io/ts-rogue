# Changesets

Changesets record release-facing changes as small Markdown files committed with
the pull request.

Run `pnpm changeset`, select `ts-rogue`, choose the SemVer impact, and write a
user-facing summary. Documentation, tests, refactors, and other changes that do
not affect a release do not need a changeset.

Maintainers consume pending changesets with `pnpm version-packages`.

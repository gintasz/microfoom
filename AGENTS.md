# Setup — do this FIRST in any fresh checkout or worktree
A new git worktree has **no `node_modules`**. Before editing, building, or committing, bootstrap it:

```bash
corepack pnpm install --frozen-lockfile
```

# Core vs. adapter
Unigent core MUST house all reusable language/runtime logic. Harness adapters and frontends (`@unigent/adapter-pi`, `@unigent/adapter-claude-cli`, `@unigent/adapter-codex-cli`, and `@unigent/cli`) contain only the minimum translation and presentation glue.

# Constitution
Read CONSTITUTION.md before starting any codebase changes or evaluations.

# Validation

When a code change is completed, always run full workspace tests, not just unit tests, not just package tests.

```bash
corepack pnpm run typecheck # types only, no tests
corepack pnpm test          # deterministic suite (unit + fake). Excludes e2e.
corepack pnpm run test:tui  # deterministic terminal rendering and 5,000-run stress suite
corepack pnpm run test:e2e  # real Pi, Claude CLI, and Codex CLI calls; requires local model authentication
corepack pnpm run build
corepack pnpm run check      # FAST static tier (typecheck, format, lint, lint:types, ast) — what pre-commit runs
corepack pnpm run check:full # FULL DoD gate (adds arch, spell, deps, dead, dup, build, api-surface, coverage) — what pre-push runs
```

Live E2E skips only when a backend is unavailable. A red authenticated run is a regression.

# Releases

All seven public packages in `scripts/release-packages.mjs` use one lockstep version. Before pushing
a `vX.Y.Z` tag, update every package manifest, version literal, lockfile, and `CHANGELOG.md`; run the
deterministic validation above, excluding live E2E unless the user explicitly requests it; then
commit and push the matching tag. `.github/workflows/release.yml` is the normal publish entrypoint:
it publishes dependency-first to `latest` through npm trusted publishing and verifies fresh-cache
SDK and global CLI installs. Monitor the workflow and confirm every package's `latest` tag before
reporting success. Do not manually publish or change dist-tags during a normal release.

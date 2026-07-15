# Contributing

Issues and PRs welcome — PRs adding adapters for other model harnesses are especially welcome.

## Publishing policy

The two packages listed in `scripts/release-packages.mjs` (`unigent-sdk` and `unigent-cli`) are
public, ESM-only, and released at one lockstep version. Internal workspaces use that version but are
private and bundled into the public artifacts. Package metadata identifies the author by name only
and must not publish a private email address.

To release, update every workspace version and the changelog, run the deterministic validation in
`AGENTS.md`, commit `release: vX.Y.Z`, and push tag `vX.Y.Z`. The tag-triggered workflow publishes
to `latest` using npm trusted publishing and verifies clean registry installs. Do
not publish individual packages or modify dist-tags manually during a normal release.

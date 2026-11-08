# Releasing and publishing (maintainers)

This repo publishes the package `@dizzlkheinz/ynab-mcpb` to the public npm registry via GitHub Actions (`.github/workflows/publish.yml`).

## Release flow

1. Bump the version in `package.json`, `package-lock.json`, `manifest.json` and `server.json`
   (`npm run verify:metadata`, part of `npm run build`, fails if they disagree), and move the
   `[Unreleased]` changelog entries under the new version.
2. Run the checks in [Before releasing](#before-releasing), commit, and push a `vX.Y.Z` tag.
3. `release.yml` (on tag push) builds the `.mcpb` and attaches it to the GitHub Release.
4. `publish.yml` (on release published) publishes to npm and then to the MCP Registry.

## What a maintainer needs access to

Handing the project over means transferring or granting all of these:

- **GitHub repo** admin (`dizzlkheinz/ynab-mcpb`), including the `npm-publish` environment.
- **Repository secrets**:
  - `YNAB_ACCESS_TOKEN`: a token for a test budget, used by the weekly live smoke workflow (`full-integration.yml`)
  - `CLAUDE_CODE_OAUTH_TOKEN`: used by `claude.yml`
  - `WORKFLOW_PAT` (optional): used by `release.yml`; it falls back to `GITHUB_TOKEN`
- **npm**: owner of `@dizzlkheinz/ynab-mcpb`, and the Trusted Publisher entry below. If the
  repo moves, update that entry to the new repo/workflow.
- **MCP Registry**: the server name `io.github.dizzlkheinz/ynab-mcpb` (`mcpName` in
  `package.json`, `name` in `server.json`) is tied to the `dizzlkheinz` GitHub namespace. A new
  owner publishing from a different account or org must rename it to their own
  `io.github.<owner>/...` namespace in both files.
- **Glama** listing: `glama.json` lists the maintainers.

`.githooks/local.sh` only extends the original maintainer's personal shared hooks
(`core.hooksPath=../githooks`); it is not needed. CI is the gate.

## Trusted publishing (OIDC)

This package is configured as a **Trusted Publisher** on npm (OIDC). With that enabled, the publish workflow does **not** need an npm token and can still work even if the package is set to “disallow tokens”.

Note: `npm whoami` will still fail in CI under OIDC; authentication happens only during `npm publish`.

## Before releasing

Pull-request CI never contacts YNAB, so run the live suites locally with a real token first:

```bash
RUN_LIVE_YNAB_TESTS=true npm run test:live        # read-only smoke
RUN_LIVE_YNAB_TESTS=true npm run test:live -- delta  # creates and deletes one $1.00 transaction in your first budget
```

Build and inspect the actual artifacts before publishing:

```bash
npm run type-check
npm run test:coverage
npm run test:integration
npm run build
npm pack --dry-run --ignore-scripts
npm run package:mcpb  # requires an installed @anthropic-ai/mcpb CLI
```

`package:mcpb` packages the existing build and fails if it is missing or invalid.
It does not rebuild, install dependencies, or modify the manifest. npm and MCPB
packaging use explicit allowlists; source, tests, reports, and demo GIFs stay out
of both distributions. npm retains the existing compiled ESM entry and types.

## Common failure: `npm ERR! need auth`

This error means the runner has no valid auth for `https://registry.npmjs.org/`.

Checklist:

- The Trusted Publisher entry matches exactly (repo, workflow filename `publish.yml`, and environment `npm-publish`).
- The workflow has `permissions: id-token: write`.
- You’re using a recent npm CLI (the workflow uses Node `24`).
- For first-time scoped publishes, the workflow uses `npm publish --access public`.

## Finishing a partially failed publish

The workflow is safe to run again for the same tag. It skips `npm publish` when
the version is already on npm, waits up to 10 minutes for npm to serve it, then
publishes to the MCP Registry. To finish a release whose registry step failed:

```bash
gh workflow run publish.yml -f tag=vX.Y.Z
```

## Local manual publish (optional)

```bash
npm adduser
npm publish --access public
```

# npm publishing (maintainers)

This repo publishes the package `@dizzlkheinz/ynab-mcpb` to the public npm registry via GitHub Actions (`.github/workflows/publish.yml`).

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

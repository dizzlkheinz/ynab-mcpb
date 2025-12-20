# npm publishing (maintainers)

This repo publishes the package `@dizzlkheinz/ynab-mcpb` to the public npm registry via GitHub Actions (`.github/workflows/publish.yml`).

## Trusted publishing (OIDC)

This package is configured as a **Trusted Publisher** on npm (OIDC). With that enabled, the publish workflow does **not** need an npm token and can still work even if the package is set to “disallow tokens”.

Note: `npm whoami` will still fail in CI under OIDC; authentication happens only during `npm publish`.

## Common failure: `npm ERR! need auth`

This error means the runner has no valid auth for `https://registry.npmjs.org/`.

Checklist:

- The Trusted Publisher entry matches exactly (repo, workflow filename `publish.yml`, and environment `npm-publish`).
- The workflow has `permissions: id-token: write`.
- You’re using a recent npm CLI (the workflow uses Node `24`).
- For first-time scoped publishes, the workflow uses `npm publish --access public`.

## Local manual publish (optional)

```bash
npm adduser
npm publish --access public
```

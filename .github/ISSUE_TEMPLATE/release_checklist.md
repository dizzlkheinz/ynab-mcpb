---
name: Release Checklist
about: Track steps for a new release
title: "Release vX.Y.Z"
labels: release
---

See `docs/maintainers/npm-publishing.md` for details.

## Before tagging

- [ ] Version bumped in `package.json`, `package-lock.json`, `manifest.json` and `server.json` (`npm run verify:metadata` checks they agree)
- [ ] `[Unreleased]` changelog entries moved under the new version
- [ ] `npm run type-check`, `npm run test:coverage`, `npm run test:integration` pass
- [ ] Live smoke run locally: `RUN_LIVE_YNAB_TESTS=true npm run test:live`
- [ ] `npm run build` and `npm pack --dry-run --ignore-scripts` look right

## Publish

- [ ] Tag pushed: `vX.Y.Z` (the `Release MCPB` workflow attaches the `.mcpb` to the GitHub Release)
- [ ] `Publish to npm & MCP Registry` workflow succeeded
- [ ] Manual sanity check in Claude Desktop (`ynab_diagnostic_info`, a few reads, one previewed write)

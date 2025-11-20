---
name: Release Checklist
about: Track steps for a new release
title: "Release vX.Y.Z"
labels: release
---

## Version

- Target: vX.Y.Z

## Checks

- [ ] Version bumped in `package.json` and `manifest.json`
- [ ] Public API surface reviewed (see `docs/VERSIONING.md`)
- [ ] Changelog entry prepared (Added/Changed/Fixed/Removed)
- [ ] Tests and lint pass
- [ ] Built with `npm run package:mcpb`
- [ ] Manual sanity check in Claude Desktop (`get_env_status`, basic tool calls)

## Publish

- [ ] Tag pushed: `vX.Y.Z`
- [ ] GitHub Release created with `.mcpb` attached
- [ ] Release notes include upgrade/migration details if needed

## Post‑release

- [ ] Update docs if applicable
- [ ] Monitor issues for regressions


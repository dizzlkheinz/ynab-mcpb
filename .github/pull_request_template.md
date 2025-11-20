## Summary

Describe the change and its motivation.

## Type of change

- [ ] Patch (backwards‑compatible fixes)
- [ ] Minor (backwards‑compatible features)
- [ ] Major (breaking changes)

## Public API surface checklist

For details, see `docs/VERSIONING.md`.

- Tools
  - [ ] No tool removals/renames, or deprecations documented
  - [ ] No changes to required args; only additive optional args
  - [ ] Output shapes preserved (only additive fields)
- Resources
  - [ ] URIs unchanged or deprecations documented
  - [ ] Response shapes preserved (only additive fields)
- Prompts
  - [ ] Names/arguments unchanged or deprecations documented
- Manifest/config
  - [ ] `user_config.YNAB_ACCESS_TOKEN` remains the auth key
  - [ ] `server.entry_point` and `mcp_config.env` remain compatible
- Runtime behavior
  - [ ] Auth and error semantics unchanged
  - [ ] `get_env_status` still functional

## Versioning and release

- Proposed version bump: `X.Y.Z` → `X.Y.Z`
- [ ] Changelog entry prepared (Added/Changed/Fixed/Removed)
- [ ] Tests and lint pass locally
- [ ] Built MCPB with `npm run package:mcpb` and sanity‑checked

## Screenshots / Logs (optional)

## Additional notes (optional)


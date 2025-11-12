# Versioning and Public API Surface

This project follows Semantic Versioning (SemVer): MAJOR.MINOR.PATCH

- MAJOR: Incompatible changes to the public API surface
- MINOR: Backwards‑compatible features and additions
- PATCH: Backwards‑compatible bug fixes, internal refactors, docs, packaging

> Current status: Pre‑1.0 (0.y.z). The API may change without notice.

## What is the public API surface?

For this MCP server, the public API is everything an MCP client or user relies on at runtime:

- Tools
  - Tool names and availability
  - Input schemas (required vs. optional arguments, value types/defaults)
  - Output shapes and documented fields
- Resources
  - Resource URIs (e.g., `ynab://budgets`, `ynab://user`)
  - Response shapes for resources
- Prompts
  - Prompt names, arguments, and text format where documented
- Manifest and configuration
  - `manifest.json` fields used by the client
  - `user_config` keys (e.g., `YNAB_ACCESS_TOKEN`) and meaning
  - `server.mcp_config.command/args/env` semantics
- Runtime environment expectations
  - Required env var name: `YNAB_ACCESS_TOKEN`
  - Authentication behavior and error semantics

Changes to any of the above that are not strictly additive are considered breaking and require a MAJOR version bump.

## Breaking vs. non‑breaking examples

Breaking (MAJOR):
- Removing or renaming a tool, resource URI, or prompt
- Changing required arguments or their types
- Removing fields from outputs or changing their types/meaning
- Renaming `YNAB_ACCESS_TOKEN` or changing how it must be provided without a compatibility layer

Non‑breaking (MINOR):
- Adding a new tool/resource/prompt
- Adding optional arguments with safe defaults
- Adding new fields to outputs without altering existing ones
- Adding diagnostics like `diagnostic_info`

Non‑breaking (PATCH):
- Bug fixes, performance improvements, docs updates, internal refactors
- Packaging/bundling changes that do not alter the public API

## Deprecation policy

When feasible, deprecate before removal:
- Keep the old name/field working for at least two MINOR releases
- Add clear warnings in docs and, if possible, runtime logs
- Provide migration notes

## PR checklist for API changes

Use this list to determine your version bump and ensure stability:

- Tools
  - [ ] No tool removals/renames, or documented deprecations provided
  - [ ] No required‑arg changes; only additive optional args with defaults
  - [ ] Output shapes preserved; only additive fields
- Resources
  - [ ] URIs unchanged, or deprecations provided
  - [ ] Response shapes preserved; only additive fields
- Prompts
  - [ ] Names/arguments unchanged, or deprecations provided
- Manifest/config
  - [ ] `user_config.YNAB_ACCESS_TOKEN` remains the key for auth
  - [ ] `server.entry_point` and `mcp_config.env` remain compatible
- Runtime behavior
  - [ ] Authentication and error semantics unchanged (e.g., messages/codes)
  - [ ] `diagnostic_info` continues to work for diagnostics
- Versioning
  - [ ] Version bump proposed: PATCH / MINOR / MAJOR
  - [ ] Changelog entry drafted (Added/Changed/Fixed/Removed)
  - [ ] Tests and lint pass

## Release process

1. Bump versions in `package.json` and `manifest.json`
2. Build and bundle: `npm run package:dxt`
3. Verify DXT runs and `diagnostic_info` shows the token when set
4. Tag: `git tag -a vX.Y.Z -m "..." && git push --tags`
5. Create a GitHub release and attach the `.dxt`

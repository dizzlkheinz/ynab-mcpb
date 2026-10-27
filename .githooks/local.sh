# Project-specific pre-commit checks, sourced by ../githooks/pre-commit.

# Unused files, exports and types (config: knip.json). A finding blocks the commit.
if have npx; then
    run "knip $KNIP_VERSION"
    npx --yes "knip@$KNIP_VERSION" --no-progress
else
    skip "npx not installed; knip"
fi

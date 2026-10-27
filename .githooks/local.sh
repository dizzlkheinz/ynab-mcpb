# Project-specific pre-commit checks, sourced by ../githooks/pre-commit.

# Unused files, exports and types (knip.json and knip.production.json), using the knip devDependency so
# the hook needs no network. knip reads the working tree, so its result describes the
# commit only when nothing is left unstaged; otherwise it is advisory and CI's
# `npm run knip` is the gate.
if [ ! -f node_modules/.bin/knip ]; then
    skip "knip not installed (run npm install)"
elif git diff --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    run "knip"
    npm run --silent knip
else
    run "knip (advisory: unstaged or untracked files present)"
    npm run --silent knip         || say "  - [warn] knip findings may come from unstaged files; CI checks the commit."
fi

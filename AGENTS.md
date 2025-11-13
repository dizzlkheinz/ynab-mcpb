# Repository Guidelines

## Project Structure & Module Organization
`src/` hosts all TypeScript modules: `server/` wires the MCP host, `tools/` defines tool handlers, `utils/` shares primitives, and `index.ts` is the entry point.
Tests live in `src/__tests__` (unit, integration, e2e, performance) with sanitized fixtures in `test-exports/` and artifacts in `test-results/`.
Documentation stays in `docs/`, automation in `scripts/`, and compiled output in `dist/` plus `dist/bundle/`; never edit generated files directly.

## Build, Test, and Development Commands
- `npm run dev` - incremental TypeScript build while coding.
- `npm run build` - clean `dist/`, compile, then esbuild-bundle.
- `npm run build:prod` / `npm run package:dxt` - production bundle with verification and DXT packing.
- `npm start` or `npm run start:mcp` - launch compiled server with `.env`.
- `npm run validate-env` - confirm required secrets before tool runs.

## Coding Style & Naming Conventions
Prettier enforces 2-space indent, 100-char width, single quotes, and semicolons; verify with `npm run format:check`.
ESLint (`npm run lint`) must pass before commits; prefer `npm run lint:fix` for safe rewrites.
Name files after their capability (`budgetService.ts`, `create-account.tool.ts`) and keep MCP tool identifiers kebab-case with ES modules and explicit dependency injection.

## Testing Guidelines
Vitest powers the suite: `npm test` runs everything then filters failures into `test-results.json`, while `test:unit`, `test:integration`, `test:e2e`, `test:performance`, and `test:coverage` target specific goals.
Use `test:comprehensive` (tsx runner) for orchestration flows, mirror test filenames to the feature, and update fixtures only with scrubbed data.

## Commit & Pull Request Guidelines
History follows Conventional Commits (`docs:`, `fix:`, `refactor:`); keep patches focused and note verification commands in every PR.
Run `npm run pr:description` to refresh `.pr-description.md` before `gh pr create`, link issues, and attach screenshots or sample JSON for user-facing changes.

## Environment & Security Tips
Clone `.env` from `.env.example`, set `YNAB_ACCESS_TOKEN` plus cache settings, then rerun `npm run validate-env` after edits.
Avoid logging secrets, prefer sample budgets when demonstrating behaviors, and delete stray exports from `test-exports/` before pushing.

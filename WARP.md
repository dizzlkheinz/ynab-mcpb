# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project overview

This repo is a TypeScript Model Context Protocol (MCP) server that lets AI assistants interact with YNAB (You Need A Budget) via YNAB's REST API. It builds a bundled Node.js server (ES modules) and an MCPB package for Claude Desktop and other MCP clients.

Key tech: Node + TypeScript (strict), Vitest for tests, ESLint + Prettier for quality, esbuild for bundling.

## Common commands

All commands assume you are in the repo root.

### Install & environment

- Install dependencies:
  - `npm install`
- Validate environment configuration (after creating `.env` from `.env.example`):
  - `npm run validate-env`

Important environment variables (see `CLAUDE.md` for full list):

- Required: `YNAB_ACCESS_TOKEN`
- Caching (optional): `YNAB_MCP_CACHE_MAX_ENTRIES`, `YNAB_MCP_CACHE_DEFAULT_TTL_MS`, `YNAB_MCP_CACHE_STALE_MS`
- Output formatting (optional): `YNAB_MCP_MINIFY_OUTPUT`, `YNAB_MCP_PRETTY_SPACES`
- Export (optional): `YNAB_EXPORT_PATH`
- Testing (optional): `TEST_BUDGET_ID`, `TEST_ACCOUNT_ID`, `SKIP_E2E_TESTS`

### Build & development

The main build pipeline is wired through `package.json` scripts and esbuild.

- Fast dev loop (TypeScript watch only):
  - `npm run dev`
- Development build (no lint, non-prod tsconfig):
  - `npm run build:dev`  
    (cleans `dist/`, compiles TypeScript, then runs the dev bundle)
- Production build (preferred for anything user-facing):
  - `npm run build`  
    alias for `npm run build:prod`
- Explicit production build:
  - `npm run build:prod`  
    runs ESLint + Prettier fix, cleans, compiles with `tsconfig.prod.json`, bundles with esbuild, then runs `verify-build`.

### Running the server locally

Build first (at least once):

- `npm run build`

Then run the compiled MCP server:

- `npm start` — loads `dist/index.js` with `dotenv` (honors `.env`)
- `npm run start:mcp` — plain start of `dist/index.js` (useful for MCP clients that set env themselves)
- `npm run start:prod` — runs with `NODE_ENV=production`

### Linting, formatting, and type-checking

- Lint and formatting check (no writes):
  - `npm run lint` — ESLint + `prettier --check`
- Auto-fix ESLint + format the repo:
  - `npm run lint:fix`
- Format only:
  - `npm run format`
- Type-check without emitting JS:
  - `npm run type-check`

### Testing

Vitest is used with multiple projects (unit, integration, e2e, performance).

High-level commands:

- Run primary suite (unit, then filter results to only failures in `test-results.json`):
  - `npm test`
- Watch mode while iterating:
  - `npm run test:watch`

Targeted suites:

- Unit tests:
  - `npm run test:unit`
- Core integration tests:
  - `npm run test:integration:core`
- Domain-specific integration tests (throttled runners):
  - `npm run test:integration:budgets`
  - `npm run test:integration:accounts`
  - `npm run test:integration:transactions`
  - `npm run test:integration:categories`
  - `npm run test:integration:payees`
  - `npm run test:integration:months`
  - `npm run test:integration:delta`
  - `npm run test:integration:reconciliation`
- Full integration sweep with throttling:
  - `npm run test:integration:full`
- End-to-end tests (real YNAB, requires `YNAB_ACCESS_TOKEN` and related test env vars):
  - `npm run test:e2e`
- Coverage for unit tests:
  - `npm run test:coverage`
- Performance tests:
  - `npm run test:performance`
- Comprehensive orchestrated test runner:
  - `npm run test:comprehensive`
- Run everything (unit + core integration + e2e + performance):
  - `npm run test:all`

Test layout & naming (from `CLAUDE.md`):

- Unit: `*.test.ts`
- Integration: `*.integration.test.ts`
- E2E: `*.e2e.test.ts`
- Tests live in `src/__tests__/` alongside source, with shared utilities in `src/__tests__/testUtils.ts` and global setup in `src/__tests__/setup.ts`.

#### Running a single test file

Use Vitest directly for fine-grained runs:

- Single file:
  - `npx vitest run src/tools/__tests__/budgetTools.test.ts`
- Single project:
  - `npx vitest run --project unit`
  - `npx vitest run --project integration`

You can also substitute any other test file path under `src/__tests__`.

### Packaging and release helpers

- Build and generate the MCPB package (used by Claude Desktop and other MCP clients):
  - `npm run package:mcpb`  
    (runs `build:prod` then `generate:mcpb`; artifact ends up under `dist/`)
- Generate `.mcpb` from an existing build:
  - `npm run generate:mcpb`
- PR helpers (used with GitHub CLI):
  - `npm run pr:description` — refresh `.pr-description.md`
  - `npm run pr:create` — update description and run `gh pr create` with it

## Architecture and layout (big picture)

This section summarizes the high-level architecture described in `CLAUDE.md`, `AGENTS.md`, and the docs.

### Top-level structure

- `src/` — TypeScript source
  - `index.ts` — main entry, wires up the MCP server.
  - `server/` — core server orchestration and cross-cutting services.
  - `tools/` — domain-specific MCP tool implementations.
  - `types/` — shared types and error classes.
  - `utils/` — low-level helpers (money, dates, amount validation, etc.).
  - `__tests__/` — unit, integration, e2e, and performance tests.
- `docs/` — user and contributor documentation (getting started, architecture, testing, deployment, reference).
- `dist/` and `dist/bundle/` — compiled output and bundles (do not edit by hand).
- `scripts/` — Node scripts for env validation, verifying builds, orchestrating integration tests, and generating PR descriptions / MCPB artifacts.

`AGENTS.md` has a concise summary of this structure; prefer working in `src/` and `docs/` and treat `dist/` and test artifacts as generated.

### Core server layer (`src/server/`)

The server layer is modular and service-oriented (see `CLAUDE.md`):

- `YNABMCPServer.ts` — central orchestration class that wires all services and registers tools.
- `toolRegistry.ts` — registry pattern for tools; centralizes metadata, Zod input schemas, annotations, and handler wiring.
- `cacheManager.ts` — caching layer with TTL presets and optional stale-while-revalidate behavior. Use its `wrap(...)` helper instead of ad-hoc caching.
- `budgetResolver.ts` — shared logic for resolving which YNAB budget to operate on (explicit `budget_id` vs default budget).
- `errorHandler.ts` — single place to construct structured error responses; use it instead of throwing raw errors from tools.
- `config.ts` — environment parsing/validation and configuration for the server.
- `resources.ts`, `prompts.ts` — MCP resource and prompt definitions and handlers.
- `diagnostics.ts` — health checks and diagnostic tooling (used by tools like `diagnostic_info`).
- `securityMiddleware.ts` — guards and validation wrappers around tool execution.
- `responseFormatter.ts` — centralized JSON response formatting (minified vs pretty based on env).
- `rateLimiter.ts` — respects YNAB rate limits; coordinate with caching when changing behavior.
- `requestLogger.ts` — logging around requests and responses.

When adding or modifying core behavior (e.g., caching, error shapes, security), prefer changing these shared services rather than duplicating logic in tools.

### Tool layer (`src/tools/`)

Tools are grouped by YNAB domain and MCP responsibility (see `CLAUDE.md` for the complete catalog):

- Budget and account tools: `budgetTools.ts`, `accountTools.ts`.
- Transaction tools: `transactionTools.ts`, including CRUD and export/reconciliation operations.
- Category and payee tools: `categoryTools.ts`, `payeeTools.ts`.
- Time-based tools: `monthTools.ts`.
- Utility tools: `utilityTools.ts` (e.g., `convert_amount`, `diagnostic_info`, cache clearing, output formatting).
- Specialized multi-file modules:
  - `compareTransactions/` — CSV comparison split into parser, matcher, and formatter pieces.
  - `financialOverview/` — higher-level analysis (schemas, handlers, insights, trends, formatters).

All tools register with the central `ToolRegistry` and attach MCP annotations via presets defined in `src/tools/toolCategories.ts` (`ToolAnnotationPresets`). These presets classify tools as:

- Read-only external (querying YNAB API only)
- Write external (create/update/delete)
- Local utilities

When introducing a new tool, follow the existing pattern:

1. Define a Zod input schema.
2. Implement a handler that uses injected services (cache manager, budget resolver, error handler, etc.).
3. Register via the registry with an appropriate annotation preset and human-readable `title`.
4. Add unit + integration tests next to the tool module.

### Types and utilities

- `src/types/index.ts` holds shared types, configuration types, error classes, and other cross-cutting definitions.
- `src/utils/money.ts` provides milliunit ↔ amount conversions; **always** go through these helpers when dealing with monetary values.
- `src/utils/dateUtils.ts` and `src/utils/amountUtils.ts` encapsulate validation and formatting rules for dates and amounts; reuse instead of reimplementing logic in tools.

YNAB uses milliunits internally (1 dollar = 1000 milliunits). All API calls should send milliunits; user-facing amounts should be presented in human-readable units.

### Testing architecture

Tests are aligned with the server/module structure (see `CLAUDE.md` and `AGENTS.md`):

- Unit tests target individual tools and services with mocked dependencies.
- Integration tests exercise YNAB interactions with more realistic flows (but often mocked HTTP).
- E2E tests talk to real YNAB budgets and accounts and therefore require specific env vars; these are slower and may be skipped via `SKIP_E2E_TESTS`.
- Performance tests (`src/__tests__/performance.test.ts`) measure throughput/latency for key operations.

Coverage targets are 80%+ across branches, functions, lines, and statements.

### Docs

`docs/README.md` is the entry point to detailed documentation:

- `docs/getting-started/` — Quick start, installation, configuration.
- `docs/guides/` — Architecture, testing, deployment, and development guidance.
- `docs/reference/` — Full API reference, tools catalog, examples, and troubleshooting.

When you need deeper context (e.g., designing a new tool, understanding architecture tradeoffs, or debugging tricky integration behavior), consult the relevant guide before making large changes.

## Repo-specific conventions and notes

- Branching & versioning (from `CLAUDE.md`):
  - Main branch is `master`; semantic versioning is used (currently `0.x.y`).
- Commits and PRs (from `AGENTS.md`):
  - Conventional Commits style is encouraged (`feat:`, `fix:`, `docs:`, `refactor:`, etc.).
  - Before creating a PR, run the relevant build/test commands and refresh the PR description via `npm run pr:description`.
- Cache invalidation:
  - Write operations (create/update/delete) are expected to invalidate or refresh related caches via `cacheManager`; avoid introducing new write paths that bypass this.
- Date format:
  - Use ISO `YYYY-MM-DD` everywhere for dates.
- Error handling:
  - Prefer returning structured errors via `ErrorHandler` utilities so that clients receive consistent JSON error payloads.

These conventions come from `CLAUDE.md` and `AGENTS.md` and should be preserved when extending or refactoring the codebase.

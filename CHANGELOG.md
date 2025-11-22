# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.13.2] - 2025-11-21

### Changed

- **Improved CI/CD Workflows** - Enhanced reliability and automation
  - Integration tests now optional with `continue-on-error` (won't block merges)
  - Increased integration test timeout to 90 minutes for rate-limited YNAB API calls
  - Added WORKFLOW_PAT support for automatic npm publish on release
  - Release workflow can now trigger publish workflow automatically

### Fixed

- **CI Timeout Issues** - Resolved integration test timeouts in GitHub Actions
  - Tests hitting YNAB API rate limits (200/hour) no longer cause failures
  - 60-minute rate limit reset waits are now accommodated
  - CI provides visibility without blocking development

## [0.13.1] - 2025-11-21

### Fixed

- Fixed missing `cached` property in large transaction list responses (>90KB)
  - Large response path now includes `cached` and `cache_info` properties
  - Maintains consistency with normal response path
  - Resolves integration test failures when accounts have many transactions
- Fixed TypeScript strict mode error in testUtils (TS4111)
  - Properties from index signatures now use bracket notation

## [0.13.0] - 2025-11-20

### Changed

- **Default Build to Production** - All builds now use minified production bundle
  - `npm run build` now aliases `build:prod` (was dev build)
  - `prepare` hook uses production build for consistent npm distribution
  - Bundle size reduced from 2.35 MB to 1.28 MB (~45% smaller)
  - Use `npm run build:dev` if you need sourcemaps for debugging
- **Integrated Linting and Formatting** - Code quality checks now run automatically
  - `npm run lint` now runs both ESLint and Prettier checks
  - `npm run lint:fix` now fixes both ESLint issues and formats with Prettier
  - `npm run build` automatically fixes code quality and formatting issues before building
  - `console.log` statements now allowed in test files for debugging
  - Use `npm run build:no-lint` to skip linting during rapid iteration
- **Reconciliation Default Tolerance** - Increased `date_tolerance_days` default from 2 to 5 days
  - Better handles typical credit card processing delays (3-5 days)
  - Matches `compare_transactions` default for consistency
  - Still configurable per-call for tighter matching when needed

### Fixed

- **Month Output Schema** - `age_of_money` now correctly accepts `null` values
  - YNAB API returns `null` when insufficient transaction history exists
  - Changed from `z.number().optional()` to `z.number().nullish()`
  - Affects both `MonthDetailSchema` and `MonthSummarySchema`

## [0.12.0] - 2025-11-19

### Added

- **Structured Output Schemas** - Zod-based output validation for all 30 tools
  - Output schemas in `src/tools/schemas/outputs/` with centralized exports
  - Automatic validation in ToolRegistry (toolRegistry.ts:401-483) using `z.safeParse()`
  - Type-safe responses with TypeScript inference
- **Unit Tests** - Full coverage for output schemas (7 test files)
  - Budget, account, transaction, category, payee, month outputs
  - Comparison and export schemas with specialized validations
- **E2E Schema Validation**
  - `validateOutputSchema()` helper in testUtils.ts
  - Schema validation integrated into workflow tests

### Changed

- ToolRegistry validates handler responses against output schemas
- `listTools()` includes `outputSchema` field in Tool objects
- TOOLS.md updated with structured output documentation

## [0.11.0] - 2025-01-14

### Added

- **Tiered Integration Testing** - Three-tier test system
  - Core: Budget-agnostic fundamental operations
  - Domain: Budget-specific tests by functional domain
  - Throttled execution respecting API rate limits
- **Delta Request System** - Incremental data fetching via YNAB delta protocol
  - `ServerKnowledgeStore`: Tracks server knowledge for delta endpoints
  - `DeltaCache`: Specialized caching with conflict detection
  - `DeltaFetcher`: Unified interface for delta-backed API calls
  - 70-90% reduction in API response size for cached data
- **Bulk Transaction Operations** - Batch handling for up to 100 transactions
  - `create_transactions`: Batch create with duplicate detection via import_id
  - `update_transactions`: Batch update with automatic cache invalidation
  - Dry-run mode and correlation metadata
- **Enhanced Transaction Metadata**
  - Optional `original_account_id` and `original_date` for cache invalidation
  - Preview functionality for updates
  - Response size management for large batches

### Changed

- Tool count: 28 → 30
- Delta-backed tools use `DeltaFetcher` for cache optimization
- Write operations support `DeltaCache` and `ServerKnowledgeStore`

### Fixed

- Cache invalidation for cross-account transaction updates
- Response size management for bulk operations

## [0.10.0] - 2025-11-03

### Added

- **Reconciliation v2** - Currency plumbing and MoneyValue objects
  - Analyzer/executor emit structured MoneyValue objects
  - Schema `docs/schemas/reconciliation-v2.json` with `csv_format` support
  - 2-3 leg combination match suggestions with insights
  - Handler uses `accounts.getAccount` with fallback

## [0.8.8] - 2025-10-13

### Changed

- Renamed package to `@dizzlkheinz/ynab-mcp-server`

## [0.8.7] - 2025-10-13

### Changed

- GitHub Actions runs unit tests before publish with provenance enabled

## [0.8.6] - 2025-10-13

### Changed

- Npm publish workflow runs unit tests only (no YNAB credentials needed)

## [0.8.5] - 2025-10-13

### Fixed

- Export transaction tests parse JSON instead of relying on spacing

## [0.8.4] - 2025-10-13

### Changed

- MCPB generation optional via cross-platform Node wrapper (CI compatible)

## [0.8.3] - 2025-10-13

### Changed

- CLI launchers: `npx @dizzlkheinz/ynab-mcp-server` starts server immediately
- GitHub Actions workflow publishes to npm with provenance

## [0.8.2] - 2025-10-13

### Added

- `create_receipt_split_transaction` - Converts categorized receipts to YNAB splits
  - Proportional tax distribution
  - Optional dry-run previews

## [0.8.1] - 2025-10-02

### Added

- Split transaction support in `create_transaction`
  - Schema validation and response formatting for subtransactions
  - Detailed subtransaction data in responses

## [0.8.0] - 2025-09-28

### Fixed

- TypeScript build error in `compareTransactions` (inlined date comparison, non-null assertions)

## [0.7.0] - 2025-09-23

### Added

- Automatic amount conversion: milliunits → dollars
- Utility functions: `milliunitsToAmount`, `amountToMilliunits`, `formatAmount`

### Changed

- **BREAKING**: All API responses return amounts in dollars (not milliunits)
- Account balances, transactions, budgets now use dollar format

### Fixed

- Amount confusion: `-1924370` milliunits → `-$1,924.37` (not `-$1,924,370`)

## [0.6.0] - 2025-09-16

### Added

- `diagnostic_info` tool consolidates debug tools (80% reduction in clutter)
- Enhanced bank reconciliation
  - Smart duplicate amount matching with chronological preference
  - Automatic date adjustment for transaction sync
  - Exact balance matching (zero tolerance)
  - Improved date range reporting

### Fixed

- Multiple identical transaction handling in reconciliation

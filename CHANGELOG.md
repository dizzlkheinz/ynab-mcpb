# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

- DXT generation optional via cross-platform Node wrapper (CI compatible)

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

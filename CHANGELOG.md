# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.23.0] - 2026-02-22

### Added

- **MCP Audit** - Added audit improvements including pretty-printing, pagination, rate limiting enhancements, resource updates, and prompt updates

### Changed

- **Documentation** - Improved README with Mermaid diagrams, refined badges, and collapsible setup sections

## [0.22.0] - 2026-02-21

### Added

- **MCP Registry & Glama** - Added MCP Registry publishing support and Glama integration

### Changed

- **Reconciliation** - Cleaned up architecture debt (6 issues)
- **Reconciliation** - Exact amount matching is now required; removed all tolerance-based matching paths
- **Dependencies** - Updated all dependencies and Biome schema

### Fixed

- **list_transactions** - Preview output now includes `account_id` field
- **Bulk Operations** - Corrected bulk update payloads and list preview order

## [0.21.2] - 2026-02-06

### Changed

- **Dependencies** - Updated all dependencies to latest versions
  - @modelcontextprotocol/sdk 1.25.3 → 1.26.0
  - @biomejs/biome 2.3.13 → 2.3.14
  - @types/node 25.2.0 → 25.2.1
  - dotenv 17.2.3 → 17.2.4
  - esbuild 0.27.2 → 0.27.3
- **Documentation** - Added comprehensive output schema documentation to CLAUDE.md
  - Schema organization table, shared components, patterns for read/write/reconciliation tools
  - Registry integration details (Zod → JSON Schema conversion, structuredContent validation)

## [0.21.1] - 2026-02-04

### Removed

- **Output Minification** - Removed `set_output_format` tool and the entire output minification system
  - Response formatter now always uses standard `JSON.stringify()`
  - Removed `YNAB_MCP_MINIFY_OUTPUT` and `YNAB_MCP_PRETTY_SPACES` environment variables
  - Removed minify override mechanism from tool registry and server
  - Simplifies codebase by ~500 lines of rarely-used formatting logic
  - Tool count reduced from 29 to 28

## [0.21.0] - 2026-02-02

### Changed

- **MCP Tool Schemas** - Restored `outputSchema` registration for all tools with MCP-safe schema normalization
  - `tools/list` now enforces root object JSON schemas for both input and output definitions
  - Output-schema-validated object responses now populate `structuredContent` automatically
  - Added regression coverage for union/composed output schemas to prevent client tool-discovery breakage
- **Tool Annotations** - Split local utility metadata into explicit read-only vs mutating presets
  - `diagnostic_info` and `get_default_budget` remain read-only
  - `clear_cache` and `set_output_format` are now correctly marked as mutating

## [0.20.1] - 2026-02-01

### Changed

- **Dependencies** - Updated all dependencies including major version bumps
  - Biome 1.9 → 2.3 (migrated config, fixed new lint rules)
  - Vitest 3.2 → 4.0 (fixed mock constructors for Vitest 4 compatibility)
  - Zod 4.1 → 4.3 (refactored schema to support Zod 4 `.pick()` restrictions)
  - esbuild 0.25 → 0.27, @types/node 24 → 25
  - MCP SDK 1.25.1 → 1.25.3, TypeScript 5.9.2 → 5.9.3
  - dotenv, tsx, @types/papaparse patch updates

### Fixed

- **Security** - Resolved lodash prototype pollution and qs DoS vulnerabilities

## [0.20.0] - 2026-02-01

### Fixed

- **Reconciliation Accuracy** - Multiple improvements to reconciliation reliability
  - Sign detector returns null for insufficient evidence instead of defaulting to false
  - Executor respects `auto_update_cleared_status` flag before marking transactions reconciled
  - `clearedBalanceAsOf` now includes reconciled transactions
  - Better report messaging for no-change scenarios
  - Improved CSV thousands separator parsing

### Changed

- **Matching Algorithm** - Simplified amount scoring in matcher for more predictable results
- **Documentation** - Updated internal CLAUDE.md docs across tools, schemas, types, and utils to reflect current codebase

## [0.18.4] - 2025-12-26

### Fixed

- **Reconciliation Date Range Filtering** - Fix bug where transactions outside the bank statement period were incorrectly flagged as "missing from bank"
  - Now filters YNAB transactions to statement period ± 7 days tolerance before matching
  - New summary fields: `ynab_in_range_count`, `ynab_outside_range_count`
  - Transactions outside the date range are reported separately in `ynab_outside_date_range`
  - Uses `Date.UTC()` for timezone-safe date calculations (prevents off-by-one-day errors)

### Changed

- **Code Organization** - Refactored `transactionTools.ts` for better maintainability
  - Extracted Zod schemas to `transactionSchemas.ts` (453 lines)
  - Extracted utility functions to `transactionUtils.ts` (536 lines)
  - Main file reduced from 2,995 to 2,274 lines (24% reduction)

## [0.18.3] - 2025-12-24

### Fixed

- **Receipt Itemization** - Truncate long item names to 150 characters in memos
  - Itemized mode: truncates name with "..." suffix
  - Collapsed mode: truncates name while preserving amount (e.g., "AAA... $10.00")

## [0.18.2] - 2025-12-24

### Added

- **Smart Collapse Logic** - Intelligent receipt itemization based on item count
  - Items >= 5: collapse into category-grouped subtransactions
  - Big ticket items (>$50): always shown separately
  - Returns/discounts: preserved as individual line items
  - Tax allocation: proportional distribution across positive categories

## [0.18.1] - 2025-12-23

### Fixed

- **Reconciliation** - Remove import_id from reconciliation to enable bank matching

## [0.18.0] - 2025-12-21

### Added

- **MCP Completions** - Autocomplete support for budgets, accounts, categories, and payees
  - Improves client-side UX for tools that accept IDs or names
  - Uses cached data to keep suggestions responsive
- **Progress Notifications** - Long-running operations can emit MCP progress updates
  - Reconciliation workflows now report progress during bulk create/update/unclear steps
  - Clients can surface progress bars when providing a progress token

## [0.16.0] - 2025-12-01

### Added

- **MCP Resource Templates** - Implemented resource templates for budgets and accounts
  - `ynab://budgets/{budget_id}` - Get detailed budget information
  - `ynab://budgets/{budget_id}/accounts` - List accounts for a specific budget
  - `ynab://budgets/{budget_id}/accounts/{account_id}` - Get detailed account information
  - Enables AI assistants to discover and access YNAB resources dynamically
  - Full caching support with configurable TTLs

- **Reconciliation System Architecture Documentation** - Comprehensive technical documentation (2,249 lines)
  - Complete system architecture with Mermaid diagrams
  - Detailed CSV parsing engine documentation
  - Transaction matching algorithm specifications
  - Execution engine patterns and bulk operation strategies
  - Testing strategy and performance characteristics
  - See `docs/technical/reconciliation-system-architecture.md`

- **CSV Delimiter Security** - Added validation for CSV delimiter override
  - Whitelist-based delimiter validation (comma, semicolon, tab, pipe, space)
  - Prevents injection attacks via malicious delimiter strings
  - Clear error messages for unsupported delimiters

### Changed

- **CSV Parser** - Enhanced delimiter handling
  - Honor explicit delimiter overrides from reconcile_account requests
  - Improved error messages for unsupported delimiters
  - Better auto-detection fallback when delimiter override fails

### Fixed

- **Build Process** - Resolved build errors and applied code formatting
- **Resource Templates** - Hardened template parameter validation and error handling

## [0.15.0] - 2025-11-30

### Changed

- **Version Bump** - Minor version increment

## [0.14.0] - 2025-11-26

### Added

- **Reconciliation V2 Architecture** - Complete redesign of reconciliation system
  - Canonical transaction types with milliunits-based amounts (eliminates float precision issues)
  - New CSV parser using PapaParse with Canadian bank presets (TD, RBC, Scotiabank, Wealthsimple, Tangerine)
  - Advanced fuzzy matching engine using fuzzball for merchant name matching
  - Configurable scoring system with amount/date/payee weights and bonuses
  - Enhanced date parsing with chrono-node supporting multiple formats
  - Auto-detection of CSV formats with comprehensive error reporting
  - Support for debit/credit column formats and European number formats
  - New dependencies: `chrono-node`, `dayjs`, `fuzzball`, `papaparse`

### Changed

- **Matching Algorithm** - Improved accuracy and configurability
  - Default amount tolerance: 1 cent (10 milliunits, down from 50)
  - Default date tolerance: 7 days (up from 2 days for bank posting delays)
  - Rebalanced weights: amount 50%, payee 35%, date 15%
  - Auto-match threshold: 85% (down from 90% for better match rates)
  - Token-set-ratio matching for payee names handles bank merchant variations

- **Code Quality** - Eliminated duplication and improved maintainability
  - Exported `normalizeConfig` function from matcher for reuse
  - Removed 23 lines of duplicated config construction in analyzer
  - Updated all documentation to reflect V2 implementation

### Fixed

- **Documentation** - Corrected outdated references and mismatches
  - Fixed file path references (removed non-existent `matcher.v2.ts`)
  - Corrected config value documentation (amountToleranceMilliunits)
  - Fixed Markdown table formatting in reconciliation plan

## [0.13.4] - 2025-11-21

### Changed

- **npm Trusted Publishing** - Switched to OIDC-based authentication
  - More secure than token-based authentication
  - No secrets to manage or rotate
  - Automatic authentication via GitHub Actions OIDC

## [0.13.3] - 2025-11-21

### Fixed

- **Publish Workflow** - Added YNAB_ACCESS_TOKEN to npm publish workflow
  - Performance tests now have required token during publish
  - Ensures all unit tests pass before npm publish

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

- **Structured Output Schemas** - Zod-based output validation for all tools
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

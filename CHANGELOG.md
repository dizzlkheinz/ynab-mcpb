# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.27.0] - 2026-07-10

### Added

- Centralized `read-only`, `preview`, and `enabled` write-safety modes with short-lived, single-use confirmations bound to validated mutation requests
- Static `core`, `read-only`, and `full` MCP tool profiles
- Scheduled transaction list/get/create/update/delete tools with delta caching and invalidation
- Deterministic spending analysis and period-comparison tools, plus five workflow prompts

### Changed

- Decimal currency inputs now use explicit `amount_decimal` and `budgeted_decimal` fields; raw values use `amount_milliunits` and `budgeted_milliunits`, with legacy integer aliases retained as deprecated compatibility paths
- The conservative default write behavior is now preview-first; set `YNAB_MCP_WRITE_MODE=enabled` to retain direct writes
- Build, publishing, MCPB metadata, documentation, and runtime metadata are generated or validated consistently from committed source

### Fixed

- Vitest 4 global coverage thresholds are now enforced correctly
- TD bank exports using a `CAD$` amount header are parsed correctly
- Scheduled transaction updates preserve explicit nulls when clearing optional fields

## [0.26.11] - 2026-07-09

### Changed

- **Dependencies** - Updated all direct dependencies to their latest releases, including major upgrades for `csv-parse` 7, TypeScript 7, and Node.js types 26
- **Tooling** - Updated Biome, Vitest, esbuild, and tsx, and synchronized the Biome configuration schema with Biome 2.5.3

## [0.26.10] - 2026-05-22

### Changed

- **Dependencies** - Updated all packages to latest versions within semver ranges
  - `@types/node` 25.6.2 → 25.9.1
  - `@vitest/coverage-v8` 4.1.5 → 4.1.7
  - `@vitest/ui` 4.1.5 → 4.1.7
  - `date-fns` 4.1.0 → 4.3.0
  - `tsx` 4.21.0 → 4.22.3
  - `vitest` 4.1.5 → 4.1.7

## [0.26.9] - 2026-05-10

### Fixed

- **`ynab_export_transactions` amounts in decimal units** — Exported transaction `amount` fields were raw YNAB milliunits; now converted to decimal currency units (e.g. `-25500` → `-25.5`) for user-facing readability in both minimal and full export modes
- **`ynab_export_transactions` path traversal guard** — Added filename sanitization (`sanitizeExportFilename`) and a path-traversal check (`buildExportFilePath`) to reject filenames with path separators, absolute paths, or control characters that could escape the export directory
- **Reconciliation statement balance sign** — `ynab_reconcile_account` no longer forces the statement balance negative for liability accounts; the caller-provided sign is preserved, allowing credit-balance statements (positive) to be reconciled correctly
- **Reconciliation currency decimal digits** — Balance verification amounts (`bank_statement_balance`, `ynab_calculated_balance`, `discrepancy`) now respect the budget's `currency_format.decimal_digits` field instead of always dividing by 1000, fixing display for currencies with non-standard decimal places
- **Reconciliation: only reconcile transactions cleared this run** — The bulk-reconcile step previously marked all already-cleared matched transactions as reconciled, including ones cleared before this session; it now only marks transactions that were explicitly cleared during the current reconciliation run
- **Reconciliation likely-cause detection** — Tightened "round amount" heuristic from `abs % 1000 === 0 || abs % 500 === 0` to `abs % 500 === 0`, reducing false positives for non-round discrepancies

## [0.26.8] - 2026-05-10

### Fixed

- **`ynab_get_month` goal amounts now in dollars** — Category goal fields (`goal_target`, `goal_under_funded`, `goal_overall_funded`, `goal_overall_left`) inside `get_month` responses were being returned in raw milliunits; now consistently converted to dollars to match `list_categories` and `get_category`
- **YNAB API compatibility** — Restored compatibility with current YNAB API response shapes for budgets, months, and completions; extracted `ynabApiCompat.ts` adapter layer to handle field differences without touching tool handlers

### Changed

- **`ynab_list_months` returns newest-first** — Month list is now ordered most-recent first (was oldest-first, matching raw YNAB API order), making the default page 1 show the current and recent months
- **TypeScript upgraded to v6** — Bumped `typescript` from `^5.9.3` to `^6.0.3` and `esbuild` from `^0.27.3` to `^0.28.0`; switched `moduleResolution` to `"bundler"` for TypeScript 6 compatibility
- **`ynab_create_account`** — Removed `lineOfCredit` account type (no longer present in YNAB API's `SaveAccountType`)

## [0.26.7] - 2026-04-03

### Changed

- **Improved `ynab_create_transaction` tool description** — Documents `flag_color`, `subtransactions`, and `import_id` parameters; clarifies when to use subtransactions vs `create_receipt_split_transaction`
- **Improved `ynab_create_transactions` tool description** — Clarifies `import_id` guidance for YNAB-side duplicate detection
- **Improved `ynab_create_receipt_split_transaction` tool description** — Documents `memo`, `receipt_subtotal`, `cleared`, `approved`, `flag_color` parameters; adds cross-reference to `create_transaction` for generic splits
- **API reference documentation** — Adds subtransaction and `import_id` guidance to `create_transaction`; cross-references `create_receipt_split_transaction` for receipt workflows

## [0.26.6] - 2026-04-03

### Changed

- **`budget_id` now optional on all tool schemas** — All 28 tool input schemas now declare `budget_id` as optional, relying on the registry's `defaultArgumentResolver` to inject the default budget ID when omitted. Handlers use `requireResolvedBudgetId()` to narrow the type at runtime, providing a clear error if no default budget is configured.
- **New `requireResolvedBudgetId()` adapter** — Centralizes the budget ID narrowing pattern in `adapters.ts`, replacing ad-hoc checks across all tool handlers

## [0.26.5] - 2026-04-03

### Fixed

- **Resource cache invalidation on writes** — Write operations (`create_account`, `update_category`, `create_transaction`, `update_transaction`, `delete_transaction`, bulk creates/updates) now invalidate MCP resource caches (budgets, accounts, categories, months) in addition to tool-level caches, preventing stale resource reads after mutations
- **`auto_unclear_missing` default changed to `false`** — Previously defaulted to `true`, which could unexpectedly unclear cleared transactions during reconciliation; now requires explicit opt-in like all other write flags

### Changed

- **Reconciliation tool description** — Documents `auto_unclear_missing` parameter and clarifies the execute example to say "explicitly enable the write flags you want"

## [0.26.4] - 2026-04-02

### Fixed

- **Reconciliation parameter simplification** — Reduced `ynab_reconcile_account` from ~22 parameters to ~15, removing redundant/unused parameters (`statement_date`, `statement_start_date`, `as_of_timezone`, `expected_bank_balance`, `force_full_refresh`, `include_structured_data`, `structured_content`, `invert_bank_amounts`) and collapsing `auto_match_threshold`/`suggestion_threshold` into a single `match_strictness` enum (`"loose"` | `"normal"` | `"strict"`)
- **Missing test migration** — Updated `performance.test.ts` to use new parameter names (`statement_end_date`, `match_strictness`) instead of removed parameters

### Added

- **`sign_convention` parameter** — New optional parameter on `ynab_reconcile_account` (`"auto"` | `"invert"` | `"as_is"`, default `"auto"`) providing an explicit override when auto-detection fails for liability accounts with unusual CSV sign conventions
- **`execution_summary` in structured output** — Reconciliation structured output now includes an optional `execution_summary` field with `transactions_created`, `transactions_updated`, `dates_adjusted`, `dry_run`, `balance_status`, and `recommendations` when actions are performed, enabling programmatic consumption of execution results
- **Auto-inferred `statement_end_date`** — When `statement_end_date` is omitted, the reconciliation handler infers it from the latest CSV transaction date and uses it for balance verification, aligning behavior with the documented tool description

## [0.26.3] - 2026-04-01

### Fixed

- **Reconciliation execution action schema** - Added 5 missing `type` values to `ExecutionActionRecordSchema`'s discriminated union (`batch_update_failed`, `batch_reconcile_failed`, `reconciliation_complete`, `diagnostic_step3_entry`, `diagnostic_unmatched_ynab`); these were emitted by the executor but not declared in the schema, causing `include_structured_data: true` output validation to fail whenever execution ran

## [0.26.2] - 2026-04-01

### Fixed

- **Reconciliation structured output** - Removed overly strict `confidence`/`confidence_score` consistency refine from `TransactionMatchSchema`; the two-pass exact-date auto-match correctly promotes a lower-scored match to `"high"` confidence, which the old refine falsely rejected
- **Reconciliation `review_duplicate` recommendations** - `parameters.bank_transaction` is now enriched with `amount_money` via the adapter before serialization; previously the raw internal type was passed through without the required field
- **Reconciliation `manual_review` recommendations** - `parameters.related_transactions` schema corrected from `z.array(z.string())` to `z.array(z.object({ source, id, description })).optional()`, matching the shape the recommendation engine actually produces

## [0.26.1] - 2026-04-01

### Fixed

- **Reconciliation output schema** - Corrected `MoneyValueSchema`, `BankTransactionSchema`, and `YNABTransactionSimpleSchema` to match actual runtime data shapes (`value_milliunits`/`value`/`value_display`/`direction`, `sourceRow`, `categoryName`), resolving `include_structured_data: true` output schema validation failures
- **CSV payee detection** - Expanded description column candidates to include `"Details"`, `"Transaction Details"`, `"Memo"`, `"Narration"`, and `"Reference"`, resolving payees showing as "Unknown" for banks that use non-standard column names
- **Reconciliation auto-match rate** - Two-pass matching: when a bank transaction has exactly one candidate with an exact date match, auto-match threshold lowers to 65 (from 85), significantly improving match rates when bank payee strings are opaque (e.g. `"CARD 8472 AUTH 5521"`)
- **Execution summary shown on 0 changes** - "N change(s) applied to YNAB" message now only appears when `N > 0`; zero-change runs show "No changes were needed" instead

### Changed

- **Liability-aware discrepancy wording** - Credit card and other liability accounts now show "YNAB under-cleared / over-cleared" instead of the asset-oriented "YNAB shows MORE/LESS than statement"
- **`max_suggestions_in_output` default raised to 20** - Previously defaulted to 10; now documented in the tool description alongside `auto_match_threshold`
- **Tool description for `ynab_reconcile_account`** - Documents statement balance sign convention for liability accounts, `auto_match_threshold` parameter, and `max_suggestions_in_output` default

## [0.26.0] - 2026-03-31

### Added

- **`cleared` filter on `ynab_list_transactions`** - New optional `cleared` parameter (`"cleared"` | `"uncleared"` | `"reconciled"`) filters transactions before pagination; applied in-memory with no API changes required
- **`max_suggestions_in_output` on `ynab_reconcile_account`** - Controls how many unmatched items and suggestions appear in the human narrative (default: 10, previously hardcoded at 5)
- **`structured_content` filter on `ynab_reconcile_account`** - New `"full"` | `"unmatched_only"` option (default `"full"`); `"unmatched_only"` limits the structured payload to `unmatched_bank`, `unmatched_ynab`, and `suggestions` to avoid exceeding MCP tool result size limits

### Fixed

- **memo crash in `ynab_compare_transactions`** - Output schemas for `MissingInBankItemSchema`, `YNABTransactionComparisonSchema`, and `ExportedTransactionFullSchema` changed `memo` from `z.string().nullable()` to `z.string().nullish()`, preventing validation errors when YNAB returns `memo: undefined`
- **`csv_data` validation error message** - Replaced cryptic refine error with an actionable message explaining both input options and suggesting `ynab_list_transactions` with the new `cleared` filter as an alternative for balance-only workflows

### Changed

- **Reconciliation typed interfaces exported** - `StructuredReconciliationPayload`, `DualChannelPayload`, and related view interfaces are now exported from `outputBuilder.ts`, replacing an unsafe `as` cast in the structured content filter
- **Reconciliation output schema strictness** - All `Filtered*` schemas and `StructuredReconciliationUnmatchedOnlySchema` in `reconciliationOutputs.ts` now use `.strict()`, consistent with the project-wide convention

## [0.25.0] - 2026-03-29

### Changed

- **YNAB SDK** - Upgraded from v2.10.0 to v4.0.0; migrated all API calls from `budgets` to `plans` namespace (`getPlans`, `getPlanById`, `getPlanMonths`, `getPlanMonth`), response data fields (`data.plans`, `data.plan`), type renames (`PlanSummary`, `NewTransaction`, `ExistingTransaction`)
- **Biome** - Updated schema version to 2.4.9; resolved all 4 `useOptionalChain` lint warnings across source and scripts

## [0.24.2] - 2026-03-29

### Changed

- **Dependencies** - Updated `@modelcontextprotocol/sdk` to 1.28.0; updated dev dependencies (Biome 2.4.9, Vitest 4.1.2, csv-parse 6.2.1, esbuild 0.27.4, @types/node 25.5.0)

## [0.24.1] - 2026-03-29

### Fixed

- **Reconciliation Bulk Creates** - Correlation now succeeds when YNAB populates `payee_id` on returned transactions; previously every bulk-created transaction landed in the `correlation_failed` bucket, reporting 0 transactions created
- **MCP SDK 1.27+ Compatibility** - All 28 tool handlers now return `structuredContent` alongside text content, resolving the `RuntimeError: Tool has an output schema but did not return structured content` thrown by SDK clients
- **Output Schema Stripping** - Zod schema stripping is now applied to handler-supplied `structuredContent`; previously the raw handler object was returned, leaking fields not declared in the output schema (e.g. `security` in diagnostic info)
- **Content Validation Ordering** - Content array validation now runs unconditionally before the `structuredContent` fast-path, so malformed content is caught centrally even when `structuredContent` is present

### Changed

- **CI** - GitHub Actions runners now opt into Node.js 24 via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, ahead of the June 2026 forced migration

## [0.24.0] - 2026-02-22

### Changed

- **SDK** - Upgraded @modelcontextprotocol/sdk from 1.26.0 to 1.27.0
- **Server Info** - Added `title`, `description`, and `websiteUrl` to MCP server metadata
- **Logging** - Declared `logging` capability in server initialization
- **Resource Annotations** - Added `audience` and `priority` annotations to all resources and resource templates
- **Documentation** - Fixed all tool name references in CLAUDE.md to use actual `ynab_` prefixed names

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

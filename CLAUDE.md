# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server for YNAB (You Need A Budget) integration, enabling AI assistants to interact with YNAB budgets, accounts, transactions, and categories. The codebase uses TypeScript with a modular, service-oriented architecture.

**Current Version:** 0.19.0

## Essential Commands

### Build & Development

```bash
npm run build              # Clean, compile TypeScript, and bundle
npm run build:no-lint      # Build without running linter
npm run build:prod         # Production build with verification
npm run dev                # TypeScript watch mode for development
npm run type-check         # Run TypeScript type checking without emitting files
```

### Testing

```bash
npm test                           # Run all unit tests + filter results
npm run test:unit                  # Unit tests only (fast, mocked dependencies)
npm run test:integration           # Integration tests (core only)
npm run test:integration:core      # Core integration tests
npm run test:integration:domain    # Domain-specific integration tests
npm run test:integration:full      # Full integration test suite (throttled)
npm run test:integration:budgets   # Budget-specific integration tests
npm run test:integration:accounts  # Account-specific integration tests
npm run test:integration:transactions  # Transaction-specific integration tests
npm run test:integration:categories    # Category-specific integration tests
npm run test:integration:payees    # Payee-specific integration tests
npm run test:integration:months    # Month-specific integration tests
npm run test:integration:delta     # Delta caching integration tests
npm run test:integration:reconciliation  # Reconciliation integration tests
npm run test:e2e                   # End-to-end tests (requires real YNAB token)
npm run test:performance           # Performance and load tests
npm run test:coverage              # Generate coverage report (requires 80% coverage)
npm run test:watch                 # Watch mode for test development
npm run test:comprehensive         # Run comprehensive test suite
npm run test:all                   # Run all tests (unit, integration, e2e, performance)
```

### Code Quality

```bash
npm run lint               # Run Biome linting
npm run lint:fix           # Auto-fix Biome lint/format issues
npm run format             # Format code with Biome
npm run format:check       # Check formatting without modifying files
```

### Packaging & Distribution

```bash
npm run package:mcpb        # Build production MCPB package for Claude Desktop
npm run generate:mcpb       # Generate MCPB file from built bundle
npm run bundle              # Bundle with esbuild (development)
npm run bundle:prod         # Bundle with minification (production)
npm run prepare             # Prepare package for publication (runs build:prod)
npm run prepublishOnly      # Pre-publish checks (runs tests + build)
```

## Architecture Overview

The architecture is modular and service-oriented:

### Core Server Components (`src/server/`)

- **YNABMCPServer.ts** - Main orchestration server, coordinates all services
- **toolRegistry.ts** - Centralized tool metadata, validation, execution, and progress notification support
- **completions.ts** - MCP completions manager for autocomplete suggestions (budget_id, account_id, category, payee)
- **cacheManager.ts** - Enhanced caching with LRU eviction, observability, and stale-while-revalidate
- **deltaCache.ts** - Delta request management with server knowledge tracking and merge operations
- **deltaCache.merge.ts** - Entity merging functions for delta responses (transactions, categories, accounts)
- **serverKnowledgeStore.ts** - Tracks last known server_knowledge values per cache key for delta requests
- **budgetResolver.ts** - Consistent budget ID resolution across all tools
- **errorHandler.ts** - Centralized error handling with dependency injection
- **config.ts** - Environment validation and server configuration
- **resources.ts** - MCP resource definitions and handlers (includes resource templates)
- **prompts.ts** - MCP prompt definitions and handlers
- **diagnostics.ts** - System diagnostics and health monitoring
- **securityMiddleware.ts** - Security validation and wrapper functions
- **responseFormatter.ts** - JSON response formatting (minification/pretty-print)
- **rateLimiter.ts** - Rate limiting for YNAB API compliance
- **requestLogger.ts** - Request/response logging middleware
- **cacheKeys.ts** - Centralized cache key generation utilities

### Tool Registration Pattern (2025-12)

- `ToolContext` (`src/types/toolRegistration.ts`) centralizes shared deps (ynabAPI, deltaFetcher/cache, knowledge store, default budget accessors, cache/diagnostic managers).
- Adapter helpers (`src/tools/adapters.ts`): `adapt`, `adaptNoInput`, `adaptWithDelta`, `adaptWrite`, and `createBudgetResolver` to inject default budget IDs; covered by unit tests in `src/tools/__tests__/adapters.test.ts`.
- Domain factories (`register*Tools`) live in each tool file: budget, account, transaction, category, payee, month, utility, reconciliation. `setupToolRegistry` now delegates to these factories.
- Shared schemas: `emptyObjectSchema`, `looseObjectSchema` in `src/tools/schemas/common.ts`.
- Server-owned inline tools that stay in `YNABMCPServer`: `set_default_budget`, `get_default_budget`, `diagnostic_info`, `clear_cache`, `set_output_format` (they depend on server internals).

### Tool Implementation (`src/tools/`)

Tools are organized by domain with some using modular sub-directories:

- **budgetTools.ts** - Budget listing and retrieval
- **accountTools.ts** - Account management
- **transactionTools.ts** - Transaction CRUD operations (v0.18.4: refactored into 3 files)
- **transactionSchemas.ts** - Transaction Zod schemas (extracted v0.18.4, 453 lines)
- **transactionUtils.ts** - Transaction utilities and helpers (extracted v0.18.4, 536 lines)
- **categoryTools.ts** - Category management
- **payeeTools.ts** - Payee listing and retrieval
- **monthTools.ts** - Monthly budget data
- **utilityTools.ts** - User info and amount conversion
- **adapters.ts** - Tool adapter implementations
- **toolCategories.ts** - Tool categorization utilities
- **compareTransactions.ts** - Transaction comparison tool entry point
- **exportTransactions.ts** - Transaction export to JSON files
- **reconcileAdapter.ts** - Legacy adapter for reconciliation tool
- **deltaFetcher.ts** - Delta request utilities for efficient API updates
- **deltaSupport.ts** - Delta request support utilities and helpers

**Modular Tool Directories:**

- **compareTransactions/** - CSV comparison tools split into parser, matcher, formatter
- **reconciliation/** - Comprehensive account reconciliation system (v2 architecture)
  - csvParser.ts - CSV parsing with bank presets (TD, RBC, Scotiabank, etc.)
  - matcher.ts - Fuzzy matching engine with configurable scoring
  - analyzer.ts - Transaction analysis and discrepancy detection
  - executor.ts - Bulk transaction operations (create/update/unclear)
  - recommendationEngine.ts - Smart reconciliation recommendations
  - reportFormatter.ts - Human-readable reconciliation reports
  - signDetector.ts - Auto-detection of debit/credit sign conventions
  - payeeNormalizer.ts - Payee name normalization for matching
  - ynabAdapter.ts - YNAB API integration layer
- **schemas/** - Zod schemas for input/output validation
  - outputs/ - Output schema definitions for all tools

### Type Definitions (`src/types/`)

- **index.ts** - Shared types, error classes, server configuration
- **toolRegistration.ts** - ToolContext, handler signatures (Handler, DeltaHandler, WriteHandler, NoInputHandler)
- **toolAnnotations.ts** - MCP annotation types and interfaces
- **reconciliation.ts** - Reconciliation-specific type definitions

### Utilities (`src/utils/`)

- **money.ts** - Amount conversion (dollars ↔ milliunits)
- **dateUtils.ts** - Date formatting and validation
- **amountUtils.ts** - Amount validation and utilities
- **baseError.ts** - Base error class for custom errors
- **errors.ts** - Custom error classes and error handling utilities
- **validationError.ts** - Validation-specific error handling

## Key Architecture Patterns

### Tool Registry Pattern

All tools register through the centralized `ToolRegistry` for consistent validation, security, and error handling:

```typescript
registry.register({
  name: 'my_tool',
  description: 'Tool description',
  inputSchema: MyToolSchema, // Zod schema
  handler: adapt(handleMyTool), // Handler function
  defaultArgumentResolver: resolveBudgetId(), // Optional auto-resolution
});
```

### Enhanced Caching with Delta Support

Use `cacheManager.wrap()` for automatic caching with observability:

```typescript
return cacheManager.wrap('cache_key', {
  ttl: CACHE_TTLS.ACCOUNTS, // Predefined TTL constants
  staleWhileRevalidate: 120000, // Optional background refresh
  loader: () => expensiveOperation(),
});
```

Cache TTL constants are defined in `cacheManager.ts`:

- `CACHE_TTLS.BUDGETS` - 10 minutes (rarely changes)
- `CACHE_TTLS.ACCOUNTS` - 5 minutes
- `CACHE_TTLS.CATEGORIES` - 5 minutes
- `CACHE_TTLS.PAYEES` - 10 minutes
- `CACHE_TTLS.TRANSACTIONS` - 2 minutes
- `CACHE_TTLS.SCHEDULED_TRANSACTIONS` - 5 minutes
- `CACHE_TTLS.USER_INFO` - 30 minutes
- `CACHE_TTLS.MONTHS` - 5 minutes

### Delta Caching Pattern

The server supports YNAB delta requests to fetch only changed data since the last request:

```typescript
import { DeltaCache } from './server/deltaCache.js';
import { ServerKnowledgeStore } from './server/serverKnowledgeStore.js';

// Delta cache automatically manages server_knowledge tracking
const result = await deltaCache.fetchWithDelta({
  cacheKey: 'transactions:budget123',
  fetchFn: (lastKnowledge) => api.getTransactions(budgetId, lastKnowledge),
  mergeFn: DeltaCache.mergeTransactions, // Built-in merge functions available
});
```

The delta cache system:

- Tracks `server_knowledge` values per cache key via `ServerKnowledgeStore`
- Automatically merges delta responses with cached snapshots
- Provides built-in merge functions for transactions, categories, and accounts
- Resets knowledge on server restart to ensure consistency
- Handles large knowledge gaps and edge cases

### Budget Resolution Pattern

Use `BudgetResolver` for consistent budget ID handling:

```typescript
const resolved = BudgetResolver.resolveBudgetId(providedId, defaultId);
if (typeof resolved !== 'string') {
  return resolved; // Returns formatted error response
}
// Use resolved budget ID
```

### Error Handling Pattern

Use centralized `ErrorHandler` for consistent error responses:

```typescript
return ErrorHandler.createErrorResponse('OPERATION_FAILED', 'Detailed error message', {
  operation: 'tool_name',
  additionalContext,
});
```

### Dependency Injection

Services use explicit dependency injection for testability:

```typescript
constructor(
  private cacheManager: CacheManager,
  private errorHandler: ErrorHandler,
  private budgetResolver: BudgetResolver
) {}
```

## MCP Resources

The server provides MCP resources for dynamic data access:

### Resource Templates

Resource templates allow AI assistants to discover and access YNAB data using URI patterns:

- `ynab://budgets/{budget_id}` - Get detailed budget information
- `ynab://budgets/{budget_id}/accounts` - List accounts for a specific budget
- `ynab://budgets/{budget_id}/accounts/{account_id}` - Get detailed account information

Resources support full caching with configurable TTLs and return structured data that AI assistants can use for analysis and recommendations.

## MCP Completions

The server provides autocomplete suggestions via MCP completions API to help AI assistants discover available values for tool arguments:

### Supported Completions

- **budget_id** - Lists all available budget IDs with names
- **account_id** - Lists account IDs for a specific budget (context-aware)
- **category** - Lists category names for a specific budget (context-aware)
- **payee** - Lists payee names for a specific budget (context-aware)

### Implementation

- **CompletionsManager** class in `src/server/completions.ts`
- Maximum 100 completions per request
- Context-aware: uses `budget_id` from prior arguments when available
- Full caching support with standard TTLs
- Returns structured completion items with labels and values

### Usage Example

When an AI assistant requests completions for the `account_id` argument, the server returns a list of accounts for the current budget, allowing the assistant to autocomplete valid account IDs.

## Progress Notifications

Long-running operations can emit MCP progress notifications to provide real-time feedback during execution:

### Implementation

- **ProgressCallback** type defined in `src/server/toolRegistry.ts`
- Optional callback passed to tool handlers via adapter pattern
- Usage: `await sendProgress?.({ progress, total, message })`
- Currently used by: `reconcile_account` tool

### Progress Notification Pattern

```typescript
// In tool handler
async function handleLongOperation(
  input: InputType,
  sendProgress?: ProgressCallback
): Promise<ResultType> {
  // Send progress updates during operation
  await sendProgress?.({
    progress: currentStep,
    total: totalSteps,
    message: 'Processing transactions...',
  });
}
```

### Tools with Progress Support

- **reconcile_account** - Reports progress during CSV parsing, matching, and bulk operations

## Tool Annotations

All tools include MCP-compliant annotations as advisory hints for AI clients. These annotations follow the Model Context Protocol specification and help AI assistants understand tool capabilities, safety characteristics, and expected behavior. The annotation system uses type-safe presets defined in `src/tools/toolCategories.ts` via the `ToolAnnotationPresets` constant.

### Annotation Hints

Each tool includes the following annotation fields:

- **`title`** - Human-readable tool name for UI display (e.g., "YNAB: List Budgets")
- **`readOnlyHint`** - Whether tool only reads data without modifications (boolean)
- **`destructiveHint`** - Whether tool performs irreversible operations like deletion (boolean)
- **`idempotentHint`** - Whether repeated identical calls are safe and produce same result (boolean)
- **`openWorldHint`** - Whether tool calls external APIs (YNAB API) vs local operations (boolean)

### Tool Categories

The system defines 5 preset annotation patterns in `src/tools/toolCategories.ts`:

- **READ_ONLY_EXTERNAL** - Read-only tools querying YNAB API
  - Examples: `list_budgets`, `get_account`, `list_transactions`
  - Characteristics: Read-only, idempotent, external API calls

- **WRITE_EXTERNAL_CREATE** - Tools creating new resources, non-idempotent
  - Examples: `create_transaction`, `create_account`
  - Characteristics: Write operations, non-idempotent (repeated calls create duplicates), external API

- **WRITE_EXTERNAL_UPDATE** - Tools updating existing resources, idempotent
  - Examples: `update_transaction`, `set_default_budget`, `reconcile_account`
  - Characteristics: Write operations, idempotent (repeated calls produce same result), external API

- **WRITE_EXTERNAL_DELETE** - Destructive tools deleting resources
  - Example: `delete_transaction` ⚠️
  - Characteristics: Write operations, destructive, idempotent, external API

- **UTILITY_LOCAL** - Local utility tools without external API calls
  - Examples: `clear_cache`, `diagnostic_info`, `set_output_format`
  - Characteristics: Local operations, no external API dependencies

### Complete Tool Classification

All 29 tools are classified into the following categories:

**Read-Only External (15 tools):**

- `list_budgets`, `get_budget`, `list_accounts`, `get_account`, `list_transactions`, `export_transactions`, `compare_transactions`, `get_transaction`, `list_categories`, `get_category`, `list_payees`, `get_payee`, `get_month`, `list_months`, `get_user`

**Write External - Create (4 tools):**

- `create_account`, `create_transaction`, `create_transactions`, `create_receipt_split_transaction`

**Write External - Update (5 tools):**

- `set_default_budget`, `reconcile_account`, `update_transaction`, `update_transactions`, `update_category`

**Write External - Delete (1 tool):**

- `delete_transaction` ⚠️

**Utility Local (4 tools):**

- `get_default_budget`, `diagnostic_info`, `clear_cache`, `set_output_format`

### Usage Example

Tool annotations are applied during tool registration using preset patterns:

```typescript
import { ToolAnnotationPresets } from '../tools/toolCategories.js';

register({
  name: 'delete_transaction',
  description: 'Delete a transaction',
  inputSchema: DeleteTransactionSchema,
  handler: adaptWrite(handleDeleteTransaction),
  metadata: {
    annotations: {
      ...ToolAnnotationPresets.WRITE_EXTERNAL_DELETE,
      title: 'YNAB: Delete Transaction',
    },
  },
});
```

## Amount Handling (Critical!)

YNAB uses **milliunits** internally (1 dollar = 1000 milliunits):

```typescript
// Converting amounts
import { milliunitsToAmount, amountToMilliunits } from './utils/money.js';

const dollars = milliunitsToAmount(25500); // 25.50
const milliunits = amountToMilliunits(25.5); // 25500

// ALL API calls require milliunits
await createTransaction({
  amount: amountToMilliunits(userInputDollars), // Convert first!
  // ...
});
```

## Testing Guidelines

### Test File Naming

- `*.test.ts` - Unit tests
- `*.integration.test.ts` - Integration tests with mocked API
- `*.e2e.test.ts` - End-to-end tests with real API (requires YNAB token)

### Test Organization

- Tests live in `__tests__/` directories next to source files
- Use `src/__tests__/testUtils.ts` for shared test utilities
- Use `src/__tests__/setup.ts` for global test setup

### Coverage Requirements

Minimum 80% coverage for all metrics (branches, functions, lines, statements)

### Running Specific Tests

```bash
vitest run src/tools/__tests__/budgetTools.test.ts     # Run single test file
vitest run --project unit                              # Run only unit tests
vitest run --project integration                       # Run only integration tests
```

## Environment Variables

Required:

- `YNAB_ACCESS_TOKEN` - YNAB Personal Access Token

Optional (Caching):

- `YNAB_MCP_CACHE_MAX_ENTRIES` (default: 1000)
- `YNAB_MCP_CACHE_DEFAULT_TTL_MS` (default: 300000 / 5 min)
- `YNAB_MCP_CACHE_STALE_MS` (default: 120000 / 2 min)

Optional (Output):

- `YNAB_MCP_MINIFY_OUTPUT` (default: true) - Minify JSON responses
- `YNAB_MCP_PRETTY_SPACES` (default: 2) - Spaces for pretty-print when not minified

Optional (Delta):

- `YNAB_MCP_ENABLE_DELTA` (default: `"true"`) - Enable delta request caching (`"true"` or `"false"`)

Optional (Export):

- `YNAB_EXPORT_PATH` - Directory for exported files (default: ~/Downloads or ~/Documents)

Optional (Testing):

- `TEST_BUDGET_ID` - Specific budget for E2E tests
- `TEST_ACCOUNT_ID` - Specific account for E2E tests
- `SKIP_E2E_TESTS` - Skip E2E tests if set

## TypeScript Configuration

Strict mode enabled with extensive safety checks:

- `strict: true` - All strict mode flags enabled
- `noImplicitAny`, `noImplicitReturns`, `noImplicitThis` - Prevent implicit any usage
- `noUnusedLocals`, `noUnusedParameters` - Prevent unused variables
- `exactOptionalPropertyTypes` - Stricter optional property handling
- `noUncheckedIndexedAccess` - Safer array/object indexing
- `allowUnreachableCode: false` - Error on unreachable code

## Code Style & Linting

- **Biome**: Linting + formatting for TypeScript/JavaScript
- **Import Style**: Use `.js` extensions in imports (ES modules)
- **Naming**: camelCase for functions/variables, PascalCase for classes/types

## Common Development Tasks

### Adding a New Tool

1. Create Zod schema in appropriate tool file (e.g., `src/tools/myTools.ts`)
2. Implement handler function following existing patterns
3. Register the tool in the appropriate domain factory (e.g., `registerBudgetTools` in
   `src/tools/budgetTools.ts`) using `ToolRegistry`
4. Add unit tests in `src/tools/__tests__/myTools.test.ts`
5. Add integration tests in `src/tools/__tests__/myTools.integration.test.ts`
6. Update API documentation in `docs/reference/API.md`

### Modifying Cache Behavior

Cache configuration is in `src/server/cacheManager.ts`. Adjust TTLs in the `CACHE_TTLS` constant or modify cache wrapper logic.

### Adding Service Modules

Service modules (like diagnostics, resources, prompts) follow a pattern:

1. Create module in `src/server/`
2. Implement with dependency injection pattern
3. Register in `YNABMCPServer` constructor
4. Add tests in `src/server/__tests__/`

## Git Workflow

- **Main branch**: `master`
- **Commit style**: Conventional commits (feat:, fix:, chore:, refactor:, test:, docs:)
- Run `npm test` and `npm run lint` before committing
- PR titles should follow: `type: description` (e.g., `feat: add bulk transaction import`)

## Reconciliation System

The reconciliation tool (`reconcile_account`) is a comprehensive account reconciliation system with advanced features:

### Key Components

- **CSV Parser** - Supports multiple bank formats with presets for Canadian banks (TD, RBC, Scotiabank, Wealthsimple, Tangerine)
- **Fuzzy Matcher** - Uses token-set-ratio matching for merchant name variations
- **Analyzer** - Detects discrepancies, duplicates, and missing transactions
- **Executor** - Handles bulk create/update/unclear operations with comprehensive error handling
- **Recommendation Engine** - Provides smart reconciliation suggestions
- **Sign Detector** - Auto-detects debit/credit sign conventions from CSV data
- **Date Range Filtering** (v0.18.4) - Filters YNAB transactions to statement period to prevent false "missing from bank" matches

### Configuration

- Amount tolerance: 1 cent (10 milliunits) by default
- Date tolerance: 7 days (accommodates bank posting delays)
- Scoring weights: amount 50%, payee 35%, date 15%
- Auto-match threshold: 85%

### Date Range Filtering (v0.18.4)

The reconciliation system now filters YNAB transactions to only those within the statement date range:

- **Purpose**: Prevents false positives for transactions outside the statement period
- **Implementation**: Uses `Date.UTC()` for timezone-safe date comparison
- **New Report Fields**:
  - `ynab_in_range_count` - YNAB transactions within statement period
  - `ynab_outside_range_count` - YNAB transactions outside statement period
- **Behavior**: Only transactions within the CSV date range are considered for matching

See `docs/technical/reconciliation-system-architecture.md` for detailed documentation.

## Boundaries

- ✅ **Always do**: Run `npm test` before commits, use milliunits for YNAB amounts, follow existing patterns
- ✅ **Always do**: Use `.js` extensions in imports, validate inputs with Zod schemas
- ⚠️ **Ask first**: Adding new dependencies, changing API response formats, modifying cache TTLs (see `src/server/cacheManager.ts`)
- 🚫 **Never do**: Commit `.env` or secrets, edit `dist/` or `node_modules/`, skip type checking
- 🚫 **Never do**: Remove failing tests without fixing, use `any` type without justification

## Important Notes

- **Amount Handling**: YNAB uses milliunits (1 dollar = 1000 milliunits) - always convert
- **Date Format**: Always use ISO format `YYYY-MM-DD` for dates
- **Budget ID Resolution**: Most tools auto-resolve budget_id from default budget if not provided
- **Error Responses**: All errors return consistent JSON format via `ErrorHandler`
- **Cache Invalidation**: Write operations (create, update, delete) should invalidate related caches
- **Rate Limiting**: YNAB API has rate limits - use delta caching and aggressive caching strategies

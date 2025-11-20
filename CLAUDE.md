# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server for YNAB (You Need A Budget) integration, enabling AI assistants to interact with YNAB budgets, accounts, transactions, and categories. The codebase uses TypeScript with a modular architecture introduced in v0.8.x.

## Essential Commands

### Build & Development

```bash
npm run build              # Clean, compile TypeScript, and bundle
npm run build:no-lint      # Build without running linter
npm run build:prod         # Production build with verification
npm run dev                # TypeScript watch mode for development
npm run type-check         # Run TypeScript type checking without emitting files
```

See [docs/development/BUILD.md](docs/development/BUILD.md) for detailed build information.

### Testing

```bash
npm test                   # Run all unit tests + filter results
npm run test:unit          # Unit tests only (fast, mocked dependencies)
npm run test:integration   # Integration tests with mocked YNAB API
npm run test:e2e           # End-to-end tests (requires real YNAB token)
npm run test:performance   # Performance and load tests
npm run test:coverage      # Generate coverage report (requires 80% coverage)
npm run test:watch         # Watch mode for test development
```

See [docs/guides/TESTING.md](docs/guides/TESTING.md) for comprehensive testing documentation.

### Code Quality

```bash
npm run lint               # Run ESLint on TypeScript files
npm run lint:fix           # Auto-fix ESLint issues
npm run format             # Format code with Prettier
npm run format:check       # Check formatting without modifying files
```

### Packaging & Distribution

```bash
npm run package:mcpb        # Build production MCPB package for Claude Desktop
npm run generate:mcpb       # Generate MCPB file from built bundle
npm run bundle             # Bundle with esbuild (development)
npm run bundle:prod        # Bundle with minification (production)
```

See [docs/guides/DEPLOYMENT.md](docs/guides/DEPLOYMENT.md) for deployment instructions.

## Architecture Overview

The v0.8.x architecture is modular and service-oriented:

### Core Server Components (`src/server/`)

- **YNABMCPServer.ts** - Main orchestration server, coordinates all services
- **toolRegistry.ts** - Centralized tool metadata, validation, and execution
- **cacheManager.ts** - Enhanced caching with LRU eviction, observability, and stale-while-revalidate
- **budgetResolver.ts** - Consistent budget ID resolution across all tools
- **errorHandler.ts** - Centralized error handling with dependency injection
- **config.ts** - Environment validation and server configuration
- **resources.ts** - MCP resource definitions and handlers
- **prompts.ts** - MCP prompt definitions and handlers
- **diagnostics.ts** - System diagnostics and health monitoring
- **securityMiddleware.ts** - Security validation and wrapper functions
- **responseFormatter.ts** - JSON response formatting (minification/pretty-print)
- **rateLimiter.ts** - Rate limiting for YNAB API compliance
- **requestLogger.ts** - Request/response logging middleware

### Tool Implementation (`src/tools/`)

Tools are organized by domain with some using modular sub-directories:

- **budgetTools.ts** - Budget listing and retrieval
- **accountTools.ts** - Account management
- **transactionTools.ts** - Transaction CRUD operations
- **categoryTools.ts** - Category management
- **payeeTools.ts** - Payee listing and retrieval
- **monthTools.ts** - Monthly budget data
- **utilityTools.ts** - User info and amount conversion
- **exportTransactions.ts** - Transaction export to JSON files
- **reconcileAccount.ts** - Comprehensive account reconciliation

**Modular Tool Directories:**

- **compareTransactions/** - CSV comparison tools split into parser, matcher, formatter
- **financialOverview/** - Financial analysis split into schemas, handlers, insights, trends, formatter

### Type Definitions (`src/types/`)

- **index.ts** - Shared types, error classes, server configuration

### Utilities (`src/utils/`)

- **money.ts** - Amount conversion (dollars ↔ milliunits)
- **dateUtils.ts** - Date formatting and validation
- **amountUtils.ts** - Amount validation and utilities

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

### Enhanced Caching (v0.8.x)

Use `cacheManager.wrap()` for automatic caching with observability:

```typescript
return cacheManager.wrap('cache_key', {
  ttl: CACHE_TTLS.ACCOUNTS, // Predefined TTL constants
  staleWhileRevalidate: 120000, // Optional background refresh
  loader: () => expensiveOperation(),
});
```

Cache TTL constants are defined in `cacheManager.ts`:

- `CACHE_TTLS.BUDGETS` - 1 hour (rarely changes)
- `CACHE_TTLS.ACCOUNTS` - 30 minutes
- `CACHE_TTLS.CATEGORIES` - 30 minutes
- `CACHE_TTLS.SHORT` - 5 minutes (transactions)
- `CACHE_TTLS.LONG` - 1 hour

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
  - Examples: `convert_amount`, `clear_cache`, `diagnostic_info`
  - Characteristics: Local operations, no external API dependencies

### Complete Tool Classification

All 30 tools are classified into the following categories:

**Read-Only External (15 tools):**

- `list_budgets`, `get_budget`, `list_accounts`, `get_account`, `list_transactions`, `export_transactions`, `compare_transactions`, `get_transaction`, `list_categories`, `get_category`, `list_payees`, `get_payee`, `get_month`, `list_months`, `get_user`

**Write External - Create (4 tools):**

- `create_account`, `create_transaction`, `create_transactions`, `create_receipt_split_transaction`

**Write External - Update (5 tools):**

- `set_default_budget`, `reconcile_account`, `update_transaction`, `update_transactions`, `update_category`

**Write External - Delete (1 tool):**

- `delete_transaction` ⚠️

**Utility Local (5 tools):**

- `get_default_budget`, `convert_amount`, `diagnostic_info`, `clear_cache`, `set_output_format`

### Expected Benefits

The tool annotation system provides several advantages:

- **Enhanced AI Client UX** - AI assistants like Claude can show warnings/confirmations for destructive tools
- **Safer Workflows** - AI understands which tools are dangerous and can prompt for confirmation before execution
- **Better Tool Discovery** - Annotations help AI clients understand tool capabilities and constraints
- **Future-Proof Integration** - As more MCP clients emerge, they'll respect these standard annotations
- **Self-Documenting API** - Metadata provides clear documentation of tool behavior without reading implementation
- **Zero Breaking Changes** - Fully backward compatible, annotations are advisory only and don't affect tool execution

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
- `YNAB_MCP_CACHE_DEFAULT_TTL_MS` (default: 1800000 / 30 min)
- `YNAB_MCP_CACHE_STALE_MS` (default: 120000 / 2 min)

Optional (Output):

- `YNAB_MCP_MINIFY_OUTPUT` (default: true) - Minify JSON responses
- `YNAB_MCP_PRETTY_SPACES` (default: 2) - Spaces for pretty-print when not minified

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

- **ESLint**: Enforced on all TypeScript files
- **Prettier**: Auto-formatting for consistent style
- **Import Style**: Use `.js` extensions in imports (ES modules)
- **Naming**: camelCase for functions/variables, PascalCase for classes/types

## Common Development Tasks

### Adding a New Tool

1. Create Zod schema in appropriate tool file (e.g., `src/tools/myTools.ts`)
2. Implement handler function following existing patterns
3. Register tool in `YNABMCPServer.ts` using `ToolRegistry`
4. Add unit tests in `src/tools/__tests__/myTools.test.ts`
5. Add integration tests in `src/tools/__tests__/myTools.integration.test.ts`
6. Update API documentation in `docs/API.md`

### Modifying Cache Behavior

Cache configuration is in `src/server/cacheManager.ts`. Adjust TTLs in the `CACHE_TTLS` constant or modify cache wrapper logic.

### Adding Service Modules

Service modules (like diagnostics, resources, prompts) follow a pattern:

1. Create module in `src/server/`
2. Implement with dependency injection pattern
3. Register in `YNABMCPServer` constructor
4. Add tests in `src/server/__tests__/`

## MCPB Packaging for Claude Desktop

The project builds a `.mcpb` file (MCP extension for Claude Desktop):

```bash
npm run package:mcpb
```

Output: `dist/ynab-mcp-server-<version>.mcpb`

The MCPB includes:

- Bundled Node.js code (single file, no node_modules)
- Manifest with extension metadata
- Environment variable configuration schema

## Git & Version Control

- **Main branch**: `master`
- **Versioning**: Semantic versioning (currently 0.x.y - pre-1.0 API)
- **Commit style**: Conventional commits encouraged (feat:, fix:, chore:, etc.)

## Important Notes

- **Backward Compatibility**: v0.8.x maintains 100% API compatibility with v0.7.x
- **Cache Invalidation**: Write operations (create, update, delete) should invalidate related caches
- **Date Format**: Always use ISO format `YYYY-MM-DD` for dates
- **Budget ID Resolution**: Most tools auto-resolve budget_id from default budget if not provided
- **Error Responses**: All errors return consistent JSON format via `ErrorHandler`
- **Security**: Input validation via Zod schemas, security middleware wraps all tool executions
- **Rate Limiting**: YNAB API has rate limits - use caching aggressively

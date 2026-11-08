# AGENTS.md

Guidance for anyone (human or AI agent) working on this repository. `CLAUDE.md` imports this
file; keep all contributor guidance here.

## What this is

A local, stdio [Model Context Protocol](https://modelcontextprotocol.io) server for
[YNAB](https://www.ynab.com). TypeScript (strict, ESM), Node 24+, published to npm as
`@dizzlkheinz/ynab-mcpb` and as an MCPB bundle for Claude Desktop. 35 tools, 9 prompts,
2 resources and 6 resource templates. User-facing tool reference: `docs/reference/API.md`.

## Commands

```bash
npm ci --ignore-scripts      # install
npm run build                # clean, lint, tsc, esbuild bundle, verify build + metadata
npm run type-check           # source and test types
npm test                     # unit tests (offline)
npm run test:integration     # mocked integration tests (offline)
npm run test:coverage        # unit tests with 80% thresholds (what CI enforces)
npm run lint                 # Biome; lint:fix / format to fix
npm run knip                 # unused files/exports/types (default, then production mode)
npm start                    # run dist/index.js; needs YNAB_ACCESS_TOKEN (.env is read)
npm run test:live            # read-only live smoke; needs RUN_LIVE_YNAB_TESTS=true + token
npm run test:live -- delta   # live delta suite; creates and deletes one transaction
npm run package:mcpb         # package the existing build; needs global @anthropic-ai/mcpb
```

Filter tests with Vitest arguments: `npm test -- -t "receipt"`,
`npm run test:integration -- transactionTools`.

CI (`.github/workflows/ci-tests.yml`) runs type-check, knip, build, `npm pack --dry-run`,
coverage and integration tests on every push and PR. That is the gate. `.githooks/local.sh`
is an optional local extension of the maintainer's personal shared hooks and is not required.

## Layout

```
src/index.ts                 entry point (stdio transport, shutdown, error reporting)
src/server/
  YNABMCPServer.ts           wires everything; owns the 4 local tools (default budget, diagnostics, clear cache)
  config.ts                  env schema (zod); loadConfig() strict at startup, getRuntimeConfig() lenient
  toolRegistry.ts            registration, input/output validation, structuredContent, progress
  writeSafety.ts             write modes and preview confirmation tokens
  toolProfiles.ts            core / full tool surfaces
  ynabClient.ts              the ONLY YNAB network boundary (rate limiting + cache invalidation)
  cacheManager.ts            LRU cache, per-type TTLs (CACHE_TTLS), stale-while-revalidate
  deltaCache.ts(.merge)      delta requests on top of the cache; serverKnowledgeStore.ts tracks knowledge
  budgetResolver.ts          budget_id resolution against the default budget
  errorHandler.ts            error normalization -> MCP error results
  resources.ts prompts.ts completions.ts diagnostics.ts markdownFormatter.ts ...
src/tools/
  <domain>Tools.ts           one register<Domain>Tools(registry, context) factory per domain
  transactionReadTools.ts / transactionWriteTools.ts / transactionSchemas.ts / transactionUtils.ts
  transactionPreflight.ts    dry-run checks against cached budget data before a token is issued
  transactionModel.ts        shared transaction shaping
  scheduledTransactionTools.ts spendingAnalytics.ts exportTransactions.ts csvFilePath.ts
  receiptSplit/              receipt split collapse logic
  compareTransactions/       read-only CSV comparison (reuses the reconciliation parser/matcher)
  reconciliation/            ynab_reconcile_account; see docs/technical/reconciliation-system-architecture.md
  schemas/common.ts          shared input schemas (emptyObjectSchema, response_format, ...)
  schemas/monetaryInput.ts   amount_decimal / amount_milliunits input handling
  schemas/outputs/           output schemas; index.ts exports what registry.register() uses
  adapters.ts                createAdapters(context) and createBudgetResolver(context)
  toolCategories.ts          ToolAnnotationPresets
src/types/                   ToolContext and handler signatures (toolRegistration.ts), annotations
src/utils/                   money.ts, dateUtils.ts, errors.ts, ynabApiCompat.ts
```

Tests live in `__tests__/` beside the code: `*.test.ts` (unit), `*.integration.test.ts`
(mocked API), `*.e2e.test.ts` (live). Shared helpers: `src/__tests__/testUtils.ts`,
global setup: `src/__tests__/setup.ts`. Fixture budget IDs such as `test-budget-1` pass
validation only because `setup.ts` calls the `@internal` `setAcceptFixtureBudgetIds(true)` seam;
production code requires UUIDs.

## Adding or changing a tool

Tools register in their domain factory. Real shape (from `payeeTools.ts`):

```ts
const { adaptWithDelta } = createAdapters(context);
const budgetResolver = createBudgetResolver(context);

registry.register({
  name: "ynab_list_payees",
  description: "...",            // what clients see; keep it in sync with the schemas
  inputSchema: ListPayeesSchema,  // zod, .strict()
  outputSchema: ListPayeesOutputSchema,
  handler: adaptWithDelta(handleListPayees),
  defaultArgumentResolver: budgetResolver<z.infer<typeof ListPayeesSchema>>(),
  metadata: {
    annotations: { ...ToolAnnotationPresets.READ_ONLY_EXTERNAL, title: "YNAB: List Payees" },
  },
});
```

Adapters: `adapt`, `adaptNoInput`, `adaptWithDelta`, `adaptWithDeltaAndProgress` (the last
passes an optional `sendProgress`; always call it as `sendProgress?.(...)`).

Checklist for a new tool:

1. Input schema (zod `"zod/v4"`, ending in `.strict()`), output schema in `schemas/outputs/`.
2. Handler + registration in the domain factory with the right annotation preset:
   `READ_ONLY_EXTERNAL`, `WRITE_EXTERNAL_CREATE`, `WRITE_EXTERNAL_UPDATE`,
   `WRITE_EXTERNAL_DELETE`, `UTILITY_LOCAL_READ_ONLY`, `UTILITY_LOCAL_MUTATION`.
   External mutations must be protected by write safety; `verify:metadata` fails otherwise.
3. Add it to `manifest.json` `tools` (verify:metadata compares it with the runtime list) and,
   if it belongs in the small surface, to `CORE_TOOL_NAMES` in `toolProfiles.ts`.
4. Unit, output-schema and integration tests.
5. Update `docs/reference/API.md`, and the tool count in `README.md` (`**N YNAB tools**`) and
   `API.md` (`provides N tools`), both checked by `verify:metadata`.

## Rules that matter

- **Amounts.** YNAB stores milliunits (1.00 = 1000). Tool inputs take exactly one of
  `amount_decimal` (currency, preferred) or `amount_milliunits` (raw integer); category funding
  uses `budgeted_decimal` / `budgeted_milliunits`. Units are never guessed from magnitude.
  Convert once at the boundary (`utils/money.ts`); internal arithmetic stays in integer
  milliunits. Outputs report amounts in currency units (mutation and reconciliation outputs
  also carry `*_milliunits` fields).
- **Dates.** `YYYY-MM-DD` everywhere. Compare dates as strings (`isDateInRange` in
  `utils/dateUtils.ts`); do any arithmetic with `Date.UTC`, never local-time `Date` parsing.
  "Today" defaults use `formatLocalISODate`.
- **Network boundary.** Every YNAB call goes through the injected `YNABClient`
  (`ynabClient.ts`). It counts each HTTP request against the rate limiter (YNAB allows 200
  per hour per token) and invalidates the budget's caches before and after every mutating
  request. Handlers never invalidate caches or create their own YNAB client.
- **Write safety.** `YNAB_MCP_WRITE_MODE`: `preview` (default) makes every mutation run its
  dry-run path and return a `confirmation_token` (in text and `structuredContent`). The
  identical request with that token executes it; tokens are single-use, expire after 2
  minutes and are bound to the tool name plus normalized validated arguments. `enabled`
  writes directly; `read-only` does not register mutation tools. Transaction dry runs run
  `transactionPreflight.ts` checks (unknown accounts/categories, over-precise amounts,
  duplicate `import_id`) before issuing a token.
- **Errors.** Return errors through `ErrorHandler.handleError(error, context)` or
  `withToolErrorHandling`, so every tool fails with the same JSON shape.
- **Reads.** Most read tools accept `response_format` (`markdown` default, or `json`; the
  scheduled-transaction tools don't) and every tool returns its validated output as
  `structuredContent`. Delta-backed reads ask YNAB for
  changes since the cached snapshot on every call.
- **Reconciliation.** Amounts must match exactly; date tolerance 7 days; the score is
  `50 + 0.15·date + 0.35·payee` plus bonuses; execution replays exactly the previewed
  operations and aborts if the account changed. Details and thresholds:
  `docs/technical/reconciliation-system-architecture.md`.
- **Exports.** Only export what another file imports (knip enforces this, and its production
  pass fails on exports only tests use; tag deliberate test seams `@internal`).

## Configuration

Server: `YNAB_ACCESS_TOKEN` (required), `YNAB_DEFAULT_BUDGET_ID`, `YNAB_MCP_WRITE_MODE`
(`preview` | `enabled` | `read-only`), `YNAB_MCP_TOOL_PROFILE` (`full` | `core`),
`YNAB_EXPORT_PATH`, `LOG_LEVEL`. Empty values count as unset. Tests: `RUN_LIVE_YNAB_TESTS`
(must be exactly `true` to contact YNAB; offline projects force it off), `TEST_BUDGET_ID`,
`TEST_ACCOUNT_ID`, `VERBOSE_TESTS`. See `.env.example`.

## Conventions

- Biome formatting (tabs), `.js` extensions in relative imports, camelCase / PascalCase.
- No `any` without a reason; no skipped type checks; don't edit `dist/` or `node_modules/`.
- Never commit `.env` or a token, and never put real budget data in fixtures.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`); main
  branch is `master`. Add a `CHANGELOG.md` entry under `[Unreleased]`; prefix breaking
  changes with **Breaking:**.
- Releasing and publishing: `docs/maintainers/npm-publishing.md`.

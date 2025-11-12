# ADR: Centralized Tool Registry Architecture

- Status: Accepted
- Date: 2025-09-24

## Context

The v0.7.x YNAB MCP server implemented every tool inside a monolithic `YNABMCPServer` class. Tool execution relied on a switch statement that manually wired Zod validation, security middleware, cache helpers, error formatting, and handler invocation. As the number of tools grew, the switch became difficult to reason about, duplicated metadata for `listTools`, and made it hard to enforce consistent validation and error handling patterns. Test coverage existed but every new tool required repetitive boilerplate.

## Decision

Create a reusable `ToolRegistry` that is responsible for:

1. Collecting tool metadata through a `ToolDefinition` contract;
2. Enforcing a single execution flow that delegates to the existing security middleware, error handler, and response formatter; and
3. Emitting MCP-compatible tool metadata (`name`, `description`, `inputSchema`) without duplicating JSON schemas manually.

The registry is constructed with explicit dependencies (`withSecurityWrapper`, `ErrorHandler`, `responseFormatter`, cache helpers) to keep the module testable and future-proof. Tools register themselves with the registry and the server consumes registry APIs (`listTools`, `getToolDefinitions`, `executeTool`).

## ToolDefinition Contract

Every tool must provide the following fields when registering:

- `name`: Stable identifier used by MCP clients.
- `description`: Human-friendly explanation surfaced by `listTools`.
- `inputSchema`: Zod schema that validates the call arguments.
- `handler`: Async function receiving `{ input, context }` where `input` is the validated payload and `context` exposes `accessToken`, `rawArguments`, `operation`, and shared cache helpers.

Optional fields:

- `security`: Override namespace/operation labels passed to `withSecurityWrapper` (defaults to `{ namespace: 'ynab', operation: name }`).
- `metadata`: Provide `inputJsonSchema` overrides or arbitrary annotations for MCP clients.
- `defaultArgumentResolver`: Lazy resolver that can supply missing arguments (e.g., default budget IDs) before validation. Values returned here are merged with explicit arguments, with explicit user input taking precedence.


## JSON Schema Generation

We rely on `zod/v4`'s native `toJSONSchema` helper to convert Zod schemas into MCP-compatible JSON Schemas. This keeps us aligned with upstream evolution (including annotations like `$schema`, minimum/maximum constraints, and OpenAPI compatibility) without maintaining custom walkers. Tool authors can still provide overrides via `metadata.inputJsonSchema` when they need bespoke output.
## Execution Flow

1. Look up the registered tool. Unknown tools produce `ErrorHandler.createValidationError` responses.
2. Merge resolver-provided defaults with raw arguments and detect per-call minify hints (`minify`, `_minify`, `__minify`).
3. Invoke `responseFormatter.runWithMinifyOverride` so that downstream formatting honours argument or explicit overrides.
4. Call `withSecurityWrapper(namespace, operation, inputSchema)` to validate parameters, apply rate limiting, and enforce request logging before the handler executes.
5. Invoke the tool `handler` with the validated input and execution context. Exceptions are routed through `ErrorHandler.handleError`.
6. Any validation failure emitted by the security layer is normalized back into `ErrorHandler.createValidationError` to keep response shapes consistent.

## Dependency Injection Rationale

- `withSecurityWrapper`: Centralizes rate limiting, validation, and logging so the registry mirrors the existing security posture.
- `ErrorHandler`: Ensures all errors — validation, security, and handler failures — surface through the established formatting pipeline.
- `responseFormatter`: Preserves the MCP minify behaviour and keeps per-call overrides localized.
- Cache helpers: Allow handlers to interact with shared caching utilities without importing singletons directly.

By injecting these collaborators we avoid hidden globals, keep the registry deterministic in tests, and make it easy to evolve individual components (e.g., swapping security middleware) without rewriting registry code.

## Consequences

- The server will register each tool exactly once and delegate both metadata and execution to the registry, eliminating the brittle switch statement.
- Future tooling (additional diagnostics, new handlers) only needs to satisfy the registry contract, reducing duplication and improving onboarding for contributors.
- Tests can target the registry in isolation by supplying mocked dependencies, providing fast feedback on validation, security, and error handling paths.
- The registry paves the way for later phases (budget-resolution helper, cache instrumentation, tool decomposition) by giving us a single choke point for common behaviours.

## Example Registration

```ts
registry.register({
  name: 'list_accounts',
  description: 'List all accounts for the active budget',
  inputSchema: ListAccountsSchema,
  defaultArgumentResolver: async ({ rawArguments }) =>
    rawArguments.budget_id ? undefined : { budget_id: await budgets.getDefaultId() },
  handler: async ({ input, context }) => {
    const data = await ynabClient.accounts.getBudgetsAccounts(input.budget_id);
    return {
      content: [
        {
          type: 'text',
          text: responseFormatter.format({ accounts: data }),
        },
      ],
    };
  },
});
```

This keeps schema, defaults, and execution in one place while the registry guarantees consistent validation, security, and formatting across every tool.

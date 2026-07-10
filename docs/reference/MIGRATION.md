# Migration guide

## Write safety

The default write behavior changes from direct execution to `preview` mode. Existing users who intentionally require the previous behavior can set:

```text
YNAB_MCP_WRITE_MODE=enabled
```

The recommended migration is to leave the default in place. Call a mutation without `confirmation_token`, review the returned dry-run output, then repeat the identical request with the short-lived token. Tokens expire after two minutes, are single-use, and are bound to the canonical tool name plus normalized validated arguments.

Set `YNAB_MCP_WRITE_MODE=read-only` to omit every YNAB mutation tool from `tools/list`.

## Monetary inputs

New integrations should use:

- `amount_decimal` for ordinary currency values such as `-12.34`.
- `amount_milliunits` for an already-converted raw YNAB integer such as `-12340`.
- `budgeted_decimal` or `budgeted_milliunits` for category funding.

The server never guesses units from a number's magnitude. Exactly one representation is accepted for each required amount.

The legacy `amount` field remains accepted as integer milliunits for transactions, subtransactions, and bulk operations. The legacy `budgeted` field remains accepted as integer milliunits for category funding. Both aliases are deprecated; migrating them is a field rename to `amount_milliunits` or `budgeted_milliunits` with no numeric conversion.

Decimal values are converted once at the API boundary with `Math.round(value * 1000)`. Internal arithmetic and split-sum validation remain integer milliunit operations.

## Tool profiles

`YNAB_MCP_TOOL_PROFILE=full` preserves the complete surface. `core` reduces discovery payload size to common reads and differentiated workflows. `read-only` exposes every explicitly read-only tool. Profile selection happens at startup and does not rely on dynamic tool registration.

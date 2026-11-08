# API Reference

This MCP server provides 35 tools, 9 prompts, 2 resources and 6 resource templates for working with YNAB budgets, accounts, transactions, categories, payees, months, scheduled transactions and reconciliation.

Legend: **core** = included in the `core` tool profile; **destructive** = irreversible delete; **write** = mutation tool, subject to the write mode below. In parameter tables, `req` is `yes` when the schema requires the field.

## Conventions

### Budget ID

`budget_id` is optional on every tool that accepts it except `ynab_get_budget`, where the schema requires it. When omitted, the default budget is used: the one set with `ynab_set_default_budget` in this session, or else `YNAB_DEFAULT_BUDGET_ID` from the server config. If neither is set, the call fails with an error asking you to set one.

### Amounts

YNAB stores money as **milliunits**: 1/1000 of a currency unit (`$12.34` = `12340`).

- `amount_decimal` (number): amount in currency units, e.g. `-12.34`. Rounded to the nearest milliunit.
- `amount_milliunits` (integer): raw YNAB milliunits, for values that are already converted.

Pass at most one of the two on any single amount. Negative amounts are outflows, positive are inflows. Category funding uses the same pair as `budgeted_decimal` / `budgeted_milliunits`. Outputs report amounts in currency units; mutation and reconciliation outputs also include explicit `*_milliunits` fields.

A few tools take plain currency numbers instead (`balance` on `ynab_create_account`, `statement_balance` on `ynab_reconcile_account`, the `receipt_*` fields and item `amount` on `ynab_create_receipt_split_transaction`).

### Dates

Dates are ISO `YYYY-MM-DD`. `ynab_get_month` takes the first day of the month (e.g. `2025-01-01`).

### Response format

These read tools accept `response_format` (`"markdown"` default, or `"json"`): `ynab_list_budgets`, `ynab_get_budget`, `ynab_list_accounts`, `ynab_get_account`, `ynab_list_transactions`, `ynab_get_transaction`, `ynab_list_categories`, `ynab_get_category`, `ynab_list_payees`, `ynab_get_payee`, `ynab_get_month`, `ynab_list_months`, `ynab_get_user`, `ynab_get_default_budget`, `ynab_diagnostic_info`. Every tool also returns `structuredContent` validated against its output schema.

List tools paginate with `limit` and `offset` and return `total_count`, `returned_count`, `offset`, `has_more` and `next_offset`. Read tools report `cached` and cache metadata.

### Write modes

`YNAB_MCP_WRITE_MODE` controls the 12 write tools (create/update/delete transactions, scheduled transactions, accounts, category budgets, and `ynab_reconcile_account`).

| Mode | Behavior |
|------|----------|
| `preview` (default) | Write tools are listed, but a call without `confirmation_token` only previews and returns a token. |
| `enabled` | Write tools execute immediately. `dry_run: true` still previews without writing. |
| `read-only` | Write tools are not registered. |

**Preview then confirm (`preview` mode):**

1. Call the write tool normally. The server runs it as a dry run and returns the preview plus `confirmation_token` and `confirmation_expires_at` (also in `structuredContent`).
2. Call the same tool again with identical arguments plus `confirmation_token` to execute.

The token is single-use, expires after 2 minutes, is held in memory only (a server restart invalidates it), and is bound to the tool name and the validated arguments. Changing any argument, reusing a token, or waiting too long is rejected with a validation error and needs a fresh preview. A failed confirmed call also consumes its token. `dry_run` itself is ignored when matching, so previews always run safely and confirmed calls always execute. `ynab_reconcile_account` executes the exact operations shown in its preview.

All write tools accept `dry_run` (boolean). In `preview` mode they additionally accept `confirmation_token` (string).

### Tool profiles

`YNAB_MCP_TOOL_PROFILE` selects which tools are listed.

| Profile | Tools |
|---------|-------|
| `full` (default) | All 35 tools. |
| `core` | The 22 tools marked **core** below. |

Tools filtered out by the profile or by `read-only` write mode are not registered.

---

## Budgets

### ynab_list_budgets (core)
List all budgets for the authenticated user.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_get_budget (core)
Summary of one budget: id, name, currency format and counts of accounts, categories, payees and months.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | yes | |
| `response_format` | `"markdown"` \| `"json"` | no | |

## Accounts

### ynab_list_accounts (core)
List accounts in a budget.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `limit` | integer | no | |
| `offset` | integer | no | Min 0 |
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_get_account (core)
Details for one account, including current balance.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `account_id` | string | yes | |
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_create_account (write)
Create an account.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `name` | string | yes | |
| `type` | enum | yes | `checking`, `savings`, `creditCard`, `cash`, `lineOfCredit`, `otherAsset`, `otherLiability` |
| `balance` | number | no | Opening balance in currency units. Default 0 |
| `dry_run` | boolean | no | |

## Transactions

### ynab_list_transactions (core)
List transactions with optional filters and pagination.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `account_id` | string | no | |
| `category_id` | string | no | When set, split lines in that category are returned |
| `since_date` | string | no | On or after (YYYY-MM-DD) |
| `until_date` | string | no | On or before (YYYY-MM-DD) |
| `type` | `"uncategorized"` \| `"unapproved"` | no | |
| `cleared` | `"cleared"` \| `"uncleared"` \| `"reconciled"` | no | |
| `import_id` | string | no | Exact match |
| `payee_id` | string | no | Exact match |
| `payee_name` | string | no | Case-insensitive substring |
| `amount_decimal` / `amount_milliunits` | number / integer | no | Exact amount; pass at most one |
| `limit` | integer | no | Default 50 |
| `offset` | integer | no | Default 0 |
| `response_format` | `"markdown"` \| `"json"` | no | |

Output has a normal form and a preview form for large results; use `ynab_export_transactions` to save a large set to a file.

### ynab_get_transaction (core)
Full details for one transaction.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `transaction_id` | string | yes | |
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_export_transactions
Export transactions to a local JSON file (directory from `YNAB_EXPORT_PATH`, default `~/Downloads` or `~/Documents`).

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `account_id` | string | no | |
| `category_id` | string | no | |
| `since_date` | string | no | |
| `type` | `"uncategorized"` \| `"unapproved"` | no | |
| `filename` | string | no | |
| `minimal` | boolean | no | Default `true` (reduced field set) |

Returns the file path, export directory, counts and a preview of the first transactions.

### ynab_create_transaction (core, write)
Create one transaction. Use `subtransactions` for a manual split, or `ynab_create_receipt_split_transaction` for itemized receipts.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `account_id` | string | yes | |
| `date` | string | yes | |
| `amount_decimal` / `amount_milliunits` | number / integer | no | Negative for expenses |
| `payee_name` | string | no | Creates the payee if not found |
| `payee_id` | string | no | Alternative to `payee_name` |
| `category_id` | string | no | |
| `memo` | string | no | |
| `cleared` | `"cleared"` \| `"uncleared"` \| `"reconciled"` | no | Default `uncleared` |
| `approved` | boolean | no | Default `false` |
| `flag_color` | `red` \| `orange` \| `yellow` \| `green` \| `blue` \| `purple` | no | |
| `import_id` | string | no | Advanced. Omit to keep the transaction eligible for later bank-import matching |
| `subtransactions` | array | no | Split lines: `amount_decimal` or `amount_milliunits`, plus optional `payee_id`, `payee_name`, `category_id`, `memo` |
| `dry_run` | boolean | no | |

### ynab_create_transactions (write)
Create 1-100 transactions in one batch with duplicate detection.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `transactions` | array | yes | Each item: `account_id` (required), `date` (required), `amount_decimal` or `amount_milliunits`, `payee_name`, `payee_id`, `category_id`, `memo`, `cleared`, `approved`, `flag_color`, `import_id` |
| `dry_run` | boolean | no | |

### ynab_create_receipt_split_transaction (core, write)
Create a split transaction from itemized receipt data. Tax is allocated proportionally across categories.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `account_id` | string | yes | |
| `payee_name` | string | yes | |
| `receipt_total` | number | yes | Positive, currency units |
| `receipt_tax` | number | yes | 0 if none |
| `receipt_subtotal` | number | no | Pre-tax subtotal, used for validation |
| `categories` | array | yes | Each: `category_id` (required), `category_name`, `items` (required; each `name` and `amount` required, optional `quantity`, `memo`) |
| `date` | string | no | Default today |
| `memo` | string | no | Applied to the parent transaction |
| `cleared` | `"cleared"` \| `"uncleared"` \| `"reconciled"` | no | |
| `approved` | boolean | no | |
| `flag_color` | enum | no | As above |
| `dry_run` | boolean | no | |

Output includes the subtransactions and a `receipt_summary`.

### ynab_update_transaction (core, write)
Update fields on one transaction. Only supplied fields change.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `transaction_id` | string | yes | |
| `account_id`, `date`, `payee_name`, `payee_id`, `category_id`, `memo`, `cleared`, `approved`, `flag_color` | as in create | no | |
| `amount_decimal` / `amount_milliunits` | number / integer | no | |
| `subtransactions` | array | no | Same shape as create |
| `dry_run` | boolean | no | |

### ynab_update_transactions (write)
Update 1-100 transactions in one batch. A non-split transaction can become a split by supplying the parent amount plus subtransactions that sum to it; lines on an existing split cannot be replaced.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `transactions` | array | yes | Each item: `id` (required) plus any of `amount_decimal`/`amount_milliunits`, `date`, `payee_name`, `payee_id`, `category_id`, `memo`, `cleared`, `approved`, `flag_color`, `subtransactions`, `original_account_id`, `original_date` |
| `dry_run` | boolean | no | |

Output has `summary` (updated, failed), `results[]` and `transactions[]`.

### ynab_delete_transaction (core, write, destructive)
Delete a transaction. Irreversible.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `transaction_id` | string | yes | |
| `dry_run` | boolean | no | |

## Scheduled transactions

### ynab_list_scheduled_transactions (core)
List scheduled transactions. Amounts are returned in decimal currency and milliunits. No `response_format`.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `limit` | integer | no | Max 500, default 100 |
| `offset` | integer | no | Default 0 |

### ynab_get_scheduled_transaction
Get one scheduled transaction.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `scheduled_transaction_id` | string | yes | |

### ynab_create_scheduled_transaction (write)
Create a recurring scheduled transaction.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `account_id` | string | yes | |
| `date` | string | yes | First occurrence |
| `frequency` | enum | yes | `never`, `daily`, `weekly`, `everyOtherWeek`, `twiceAMonth`, `every4Weeks`, `monthly`, `everyOtherMonth`, `every3Months`, `every4Months`, `twiceAYear`, `yearly`, `everyOtherYear` |
| `amount_decimal` / `amount_milliunits` | number / integer | no | |
| `payee_id`, `payee_name`, `category_id`, `memo` | string or null | no | |
| `flag_color` | enum or null | no | `red`, `orange`, `yellow`, `green`, `blue`, `purple` |
| `dry_run` | boolean | no | |

### ynab_update_scheduled_transaction (write)
Update selected fields on a scheduled transaction.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `scheduled_transaction_id` | string | yes | |
| `account_id`, `date`, `frequency`, `amount_decimal`/`amount_milliunits`, `payee_id`, `payee_name`, `category_id`, `memo`, `flag_color` | as in create | no | Nullable fields accept `null` |
| `dry_run` | boolean | no | |

### ynab_delete_scheduled_transaction (write, destructive)
Delete a scheduled transaction.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `scheduled_transaction_id` | string | yes | |
| `dry_run` | boolean | no | |

## Categories

### ynab_list_categories (core)
List categories (also returned grouped as `category_groups`).

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `limit` | integer | no | |
| `offset` | integer | no | Min 0 |
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_get_category (core)
Current-month details for one category.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `category_id` | string | yes | |
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_update_category (write)
Set the budgeted amount for a category in the current month.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `category_id` | string | yes | |
| `budgeted_decimal` / `budgeted_milliunits` | number / integer | no | Funding amount in currency units / milliunits |
| `dry_run` | boolean | no | |

## Payees

### ynab_list_payees (core)
List payees.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `limit` | integer | no | Default 50 |
| `offset` | integer | no | Default 0 |
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_get_payee
Details for one payee.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `payee_id` | string | yes | |
| `response_format` | `"markdown"` \| `"json"` | no | |

## Months

### ynab_get_month (core)
Full budget data for a month, including all category balances.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `month` | string | yes | First day of the month, `YYYY-MM-DD` |
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_list_months
List month summaries.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `limit` | integer | no | |
| `offset` | integer | no | Min 0 |
| `response_format` | `"markdown"` \| `"json"` | no | |

## Reconciliation & comparison

CSV input is supplied as `csv_file_path` or inline `csv_data` (one of them). `csv_format` describes the file layout; all of its fields are optional.

| `csv_format` field | Type | Notes |
|---|---|---|
| `date_column`, `description_column` | string or number | Header name or index. Defaults on compare: `Date`, `Description` |
| `amount_column`, `debit_column`, `credit_column` | string or number | Use `amount_column`, or `debit_column` and `credit_column` |
| `date_format` | string | Default on compare: `MM/DD/YYYY` |
| `has_header` | boolean | Default `true` on compare |
| `delimiter` | string | Default `,` on compare |

### ynab_compare_transactions (core)
Compare bank CSV rows with YNAB transactions to find missing or mismatched entries. Read-only.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `account_id` | string | yes | |
| `csv_file_path` / `csv_data` | string | one required | |
| `csv_format` | object | no | See above |
| `amount_tolerance` | number | no | 0-1, default 0.01 |
| `date_tolerance_days` | number | no | 0-7, default 5 |
| `enable_chronology_bonus` | boolean | no | Default `false` |
| `statement_start_date` | string | no | Window start |
| `statement_date` | string | no | Window end |
| `auto_detect_format` | boolean | no | Default `false` |
| `debug` | boolean | no | Default `false` |

Output: `summary`, `matches`, `missing_in_ynab`, `missing_in_bank`.

### ynab_reconcile_account (core, write)
Guided reconciliation: match CSV rows to YNAB, detect discrepancies, and optionally create, clear or unclear transactions. `dry_run` defaults to `true`; set `dry_run: false` and enable the specific `auto_*` flags to write. In `preview` mode the confirmed call executes exactly the operations shown in the preview.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `account_id` | string | yes | |
| `statement_balance` | number | yes | Currency units. Negative for credit cards and other liabilities (owed amounts) |
| `csv_file_path` / `csv_data` | string | one required | |
| `csv_format` | object | no | See above |
| `statement_end_date` | string | no | Filters the CSV and triggers balance verification; auto-detected if omitted |
| `date_tolerance_days` | number | no | 0-7, default 7 |
| `match_strictness` | `"loose"` \| `"normal"` \| `"strict"` | no | |
| `sign_convention` | `"auto"` \| `"invert"` \| `"as_is"` | no | How CSV amount signs are interpreted |
| `auto_create_transactions` | boolean | no | Default `false` |
| `auto_update_cleared_status` | boolean | no | Default `false` |
| `auto_unclear_missing` | boolean | no | Default `false`. Unclear cleared transactions missing from the statement when still unbalanced |
| `auto_adjust_dates` | boolean | no | Default `false` |
| `dry_run` | boolean | no | Default `true` |
| `max_suggestions_in_output` | integer | no | Default 20 |

Output: `human` (narrative report) and, when available, `structured` data (unmatched items, suggestions, execution summary). Reports progress notifications while running.

## Analytics

Spending totals are computed deterministically by the server over the complete period before grouping. Transfers are excluded unless `include_transfers` is `true`.

### ynab_analyze_spending (core)
Income, spending and net totals for an inclusive date range.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `since_date` | string | yes | |
| `until_date` | string | yes | |
| `group_by` | enum | yes | `category`, `payee`, `account`, `week`, `month` |
| `include_transfers` | boolean | no | Default `false` |

### ynab_compare_spending_periods (core)
Compare two periods with total and per-group differences.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | no | |
| `period_a` | object | yes | `{ since_date, until_date }`, both required |
| `period_b` | object | yes | `{ since_date, until_date }`, both required |
| `group_by` | enum | yes | As above |
| `include_transfers` | boolean | no | Default `false` |

## Utilities

### ynab_get_user (core)
Information about the authenticated YNAB user.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_set_default_budget (core)
Set the default budget used when `budget_id` is omitted. Local to the server process; not a YNAB write.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `budget_id` | string | yes | |

### ynab_get_default_budget (core)
Get the configured default budget ID.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_diagnostic_info
Server health, memory, environment, cache, delta and security diagnostics.

| Parameter | Type | Req | Notes |
|---|---|---|---|
| `include_memory`, `include_environment`, `include_server`, `include_security`, `include_cache`, `include_delta` | boolean | no | Each defaults to `true` |
| `response_format` | `"markdown"` \| `"json"` | no | |

### ynab_clear_cache
Clear all in-memory caches. No YNAB data is modified. Takes no parameters.

---

## Prompts

Prompts that take `budget_name` use the first budget when it is omitted.

| Prompt | Arguments (* required) | Purpose |
|---|---|---|
| `create-transaction` | `account_name`*, `amount`*, `payee`*, `budget_name`, `category`, `memo` | Create a transaction |
| `budget-summary` | `budget_name`, `month` (YYYY-MM, default current) | Summarize budget status |
| `reconcile-account` | `account_name`*, `statement_balance`* (dollars), `budget_name`, `csv_data` | Reconcile an account against a statement |
| `account-balances` | `budget_name`, `account_type` | Check balances across accounts |
| `weekly-budget-review` | `since_date`*, `until_date`* | Review deterministic spending for a week |
| `uncategorized-transaction-review` | `since_date`*, `until_date`* | Review uncategorized transactions without guessing categories |
| `month-end-close` | `month`* (YYYY-MM) | Read-first month-end checklist |
| `spending-period-comparison` | `period_a_since`*, `period_a_until`*, `period_b_since`*, `period_b_until`* | Compare two periods using server-calculated totals |
| `scheduled-cash-flow-review` | `until_date`* | Review scheduled inflows and outflows |

## Resources

| URI | Name | Content |
|---|---|---|
| `ynab://budgets` | YNAB Budgets | All available budgets |
| `ynab://user` | YNAB User Info | Current user ID and email |

## Resource templates

| URI template | Content |
|---|---|
| `ynab://budgets/{budget_id}` | Budget details |
| `ynab://budgets/{budget_id}/accounts` | Accounts for a budget |
| `ynab://budgets/{budget_id}/accounts/{account_id}` | One account |
| `ynab://budgets/{budget_id}/categories` | Flattened categories |
| `ynab://budgets/{budget_id}/months` | Month summaries |
| `ynab://budgets/{budget_id}/months/{month}` | One month (`month` = first day, `YYYY-MM-DD`) |

All resources return JSON.

## Errors

Failures return `isError: true` with a JSON error body containing a `code`, a user-friendly `message` and suggestions. Codes are the YNAB HTTP statuses (400, 401, 403, 404, 429, 500) or `VALIDATION_ERROR`, `RATE_LIMIT_EXCEEDED` and `UNKNOWN_ERROR`.

Notable cases:

- **Validation**: bad parameters, or a rejected `confirmation_token` (expired, already used, or not matching the tool and arguments). Preview again to get a new token.
- **401**: the YNAB access token is invalid or expired.
- **No default budget**: omit-`budget_id` calls fail until `ynab_set_default_budget` is called.
- **Committed write with failed response validation**: the error states the write went through; do not retry, verify with a read tool.
- **429 / rate limit**: wait and retry.

# YNAB MCP Server - Tools Quick Reference

Quick reference guide for all available tools. For detailed documentation, see the [complete API Reference](API.md).

## Tool Categories

- [Budget Management](#budget-management) (4 tools)
- [Account Management](#account-management) (3 tools)
- [Transaction Management](#transaction-management) (9 tools)
- [Category Management](#category-management) (3 tools)
- [Payee Management](#payee-management) (2 tools)
- [Monthly Data](#monthly-data) (2 tools)
- [Utilities](#utilities) (2 tools)
- [Diagnostics](#diagnostics) (3 tools)

**Total: 28 tools**

---

## Budget Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_budgets` | List all budgets | None |
| `get_budget` | Get budget details | `budget_id` |
| `set_default_budget` | Set default budget | `budget_id` |
| `get_default_budget` | Get current default | None |

**Common Use**: Always call `set_default_budget` first to enable automatic budget resolution in other tools.

---

## Account Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_accounts` | List all accounts | `budget_id`* |
| `get_account` | Get account details | `budget_id`*, `account_id` |
| `create_account` | Create new account | `budget_id`*, `name`, `type`, `balance`? |

**Account Types**: `checking`, `savings`, `creditCard`, `cash`, `lineOfCredit`, `otherAsset`, `otherLiability`

---

## Transaction Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_transactions` | List transactions | `budget_id`*, `account_id`?, `since_date`? |
| `export_transactions` | Export to JSON file | `budget_id`*, `account_id`?, `since_date`? |
| `compare_transactions` | Compare CSV with YNAB | `budget_id`*, `csv_content`, `account_id`? |
| `reconcile_account` | Reconcile with CSV | `budget_id`*, `account_id`, `csv_content`, `statement_balance`? |
| `get_transaction` | Get transaction details | `budget_id`*, `transaction_id` |
| `create_transaction` | Create transaction | `budget_id`*, `account_id`, `amount`, `date`, ... |
| `create_receipt_split_transaction` | Create split from receipt | `budget_id`*, `account_id`, `receipt_items`, `tax`, ... |
| `update_transaction` | Update transaction | `budget_id`*, `transaction_id`, ... |
| `delete_transaction` | Delete transaction | `budget_id`*, `transaction_id` |

**Note**: Amounts are in milliunits for create/update operations (1 dollar = 1000 milliunits)

---

## Category Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_categories` | List all categories | `budget_id`* |
| `get_category` | Get category details | `budget_id`*, `category_id` |
| `update_category` | Update category budget | `budget_id`*, `month`, `category_id`, `budgeted` |

**Note**: Categories are organized in category groups. Use `list_categories` to see the hierarchy.

---

## Payee Management

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_payees` | List all payees | `budget_id`* |
| `get_payee` | Get payee details | `budget_id`*, `payee_id` |

---

## Monthly Data

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `get_month` | Get monthly budget data | `budget_id`*, `month` |
| `list_months` | List all months summary | `budget_id`* |

**Month Format**: `YYYY-MM-01` (always use first day of month)

---

## Utilities

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `get_user` | Get user information | None |
| `convert_amount` | Convert dollars ↔ milliunits | `amount`, `to_milliunits` |

**Conversion**:
- Dollars to milliunits: `multiply by 1000`
- Milliunits to dollars: `divide by 1000`

---

## Diagnostics

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `diagnostic_info` | Get system diagnostics | None |
| `clear_cache` | Clear the cache | None |
| `set_output_format` | Configure output format | `minify`, `spaces`? |

**Diagnostic Info Includes**:
- Server version and uptime
- Cache statistics (hit rate, entries)
- Memory usage
- Environment configuration
- Authentication status

---

## Parameter Conventions

### Required vs Optional

- **Required parameters**: Must be provided
- **Optional parameters**: Marked with `?` can be omitted
- **Auto-resolved parameters**: Marked with `*` are auto-filled if default budget is set

### Common Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `budget_id` | string | Budget ID (auto-resolved if default set) |
| `account_id` | string | Account ID |
| `transaction_id` | string | Transaction ID |
| `category_id` | string | Category ID |
| `amount` | number | Amount in milliunits |
| `date` | string | Date in YYYY-MM-DD format |
| `since_date` | string | Filter date in YYYY-MM-DD format |

### Amount Handling

**Input (create/update)**:
- Use milliunits: `$25.50` → `25500`
- Negative for outflows: `$-50.00` → `-50000`
- Positive for inflows: `$100.00` → `100000`

**Output (list/get)**:
- Automatically converted to dollars
- Example: `25500` milliunits → `$25.50`

### Date Formats

All dates must use ISO 8601 format: `YYYY-MM-DD`

✅ Valid: `2024-01-15`, `2024-12-31`
❌ Invalid: `01/15/2024`, `15-01-2024`, `2024-1-15`

---

## Quick Start Workflow

### 1. Initial Setup

```
1. list_budgets              → Get budget IDs
2. set_default_budget        → Set your budget
3. list_accounts             → View accounts
4. list_categories           → View categories
```

### 2. View Data

```
1. list_transactions         → Recent transactions
2. get_month                 → Monthly budget data
3. list_payees               → Available payees
```

### 3. Create Transaction

```
1. convert_amount            → Convert dollars to milliunits
2. create_transaction        → Create the transaction
3. get_transaction           → Verify created transaction
```

### 4. Monitor & Debug

```
1. diagnostic_info           → Check system health
2. clear_cache               → Clear if data seems stale
```

---

## Error Responses

All tools return consistent error formats:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "additional": "context"
    }
  }
}
```

**Common Error Codes**:
- `AUTHENTICATION_ERROR` - Invalid or expired token
- `AUTHORIZATION_ERROR` - Insufficient permissions
- `VALIDATION_ERROR` - Invalid parameters
- `RESOURCE_NOT_FOUND` - Budget/account/transaction not found
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `OPERATION_FAILED` - General failure

---

## Tool Selection Guide

### I want to...

**View my budgets**
→ `list_budgets`, then `set_default_budget`

**View account balances**
→ `list_accounts`

**View recent transactions**
→ `list_transactions` with `since_date`

**Create a transaction**
→ `create_transaction` (convert amount first)

**Create split transaction from receipt**
→ `create_receipt_split_transaction`

**Import bank transactions**
→ `compare_transactions` or `reconcile_account`

**View spending by category**
→ `get_month` with target month

**Check system health**
→ `diagnostic_info`

**Troubleshoot cache issues**
→ `diagnostic_info` then `clear_cache` if needed

---

## Performance Tips

1. **Set Default Budget**: Always call `set_default_budget` first to:
   - Enable automatic budget ID resolution
   - Trigger cache warming for faster subsequent operations

2. **Leverage Caching**: Repeated calls to these tools are cached:
   - `list_accounts` - 30 min TTL
   - `list_categories` - 30 min TTL
   - `list_payees` - 30 min TTL
   - `get_month` - 5 min TTL

3. **Use Filters**: Narrow results with filters:
   - `list_transactions`: Use `since_date`, `account_id`
   - Reduces response size and improves performance

4. **Batch Operations**: For multiple transactions:
   - Use `export_transactions` for bulk reads
   - Process in batches of 5-10 for creates

---

## Additional Resources

- **[Complete API Reference](API.md)** - Detailed documentation with examples
- **[Development Guide](../guides/DEVELOPMENT.md)** - Common patterns and best practices
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues and solutions
- **[Examples](EXAMPLES.md)** - Practical usage examples

---

**Quick Links**: [API Reference](API.md) | [Development Guide](../guides/DEVELOPMENT.md) | [Troubleshooting](TROUBLESHOOTING.md)

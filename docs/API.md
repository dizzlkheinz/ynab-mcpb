# YNAB MCP Server API Reference

This document provides comprehensive documentation for all tools available in the YNAB MCP Server, including parameters, examples, and error handling.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Data Formats](#data-formats)
- [Budget Management Tools](#budget-management-tools)
- [Account Management Tools](#account-management-tools)
- [Transaction Management Tools](#transaction-management-tools)
- [Category Management Tools](#category-management-tools)
- [Payee Management Tools](#payee-management-tools)
- [Monthly Data Tools](#monthly-data-tools)
- [Financial Analysis Tools](#financial-analysis-tools)
- [Natural Language & AI Tools](#natural-language--ai-tools)
- [Utility Tools](#utility-tools)
- [Diagnostic Tools](#diagnostic-tools)
- [Error Handling](#error-handling)

## Overview

The YNAB MCP Server provides 27 tools that enable AI assistants to interact with YNAB data. All tools follow consistent patterns for parameters, responses, and error handling.

### Tool Naming Convention

All tools follow a simple naming pattern with an action and resource:
- `list_budgets` - List operation on budgets
- `get_budget` - Get operation on a specific budget
- `create_transaction` - Create operation for transactions

## Authentication

All tools require authentication via a YNAB Personal Access Token set in the `YNAB_ACCESS_TOKEN` environment variable.

```bash
YNAB_ACCESS_TOKEN=your_personal_access_token_here
```

## Data Formats

### Monetary Amounts

**📢 New in v0.7.0**: All monetary amounts are automatically converted to standard dollar format for human readability.

The server automatically converts YNAB's internal milliunits to dollars in all responses:
- Account balances: `-1924.37` (instead of `-1924370` milliunits)
- Transaction amounts: `50.25` (instead of `50250` milliunits)
- Budget amounts: `150.00` (instead of `150000` milliunits)

**Input formats**:
- When creating transactions, amounts should be provided in milliunits (as per YNAB API requirements)
- Use the `convert_amount` tool to convert between dollars and milliunits if needed

**Legacy behavior**: YNAB's internal representation uses milliunits (1/1000th of currency unit), but this is now transparent to users

### Dates

All dates use ISO 8601 format: `YYYY-MM-DD`
- Example: `2024-01-15`
- Time zones are handled by YNAB based on your account settings

### IDs

All YNAB IDs are UUID strings:
- Budget ID: `12345678-1234-1234-1234-123456789012`
- Account ID: `87654321-4321-4321-4321-210987654321`

## Budget Management Tools

### list_budgets

Lists all budgets associated with the user's account.

**Parameters:** None

**Example Request:**
```json
{
  "name": "list_budgets",
  "arguments": {}
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"budgets\": [\n    {\n      \"id\": \"12345678-1234-1234-1234-123456789012\",\n      \"name\": \"My Budget\",\n      \"last_modified_on\": \"2024-01-15T10:30:00.000Z\",\n      \"first_month\": \"2024-01-01\",\n      \"last_month\": \"2024-12-01\",\n      \"date_format\": {\n        \"format\": \"MM/DD/YYYY\"\n      },\n      \"currency_format\": {\n        \"iso_code\": \"USD\",\n        \"example_format\": \"123,456.78\",\n        \"decimal_digits\": 2,\n        \"decimal_separator\": \".\",\n        \"symbol_first\": true,\n        \"group_separator\": \",\",\n        \"currency_symbol\": \"$\",\n        \"display_symbol\": true\n      }\n    }\n  ]\n}"
    }
  ]
}
```

### get_budget

Gets detailed information for a specific budget.

**Parameters:**
- `budget_id` (string, required): The ID of the budget to retrieve

**Example Request:**
```json
{
  "name": "get_budget",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012"
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"budget\": {\n    \"id\": \"12345678-1234-1234-1234-123456789012\",\n    \"name\": \"My Budget\",\n    \"last_modified_on\": \"2024-01-15T10:30:00.000Z\",\n    \"first_month\": \"2024-01-01\",\n    \"last_month\": \"2024-12-01\",\n    \"accounts\": [...],\n    \"payees\": [...],\n    \"payee_locations\": [...],\n    \"category_groups\": [...],\n    \"categories\": [...],\n    \"months\": [...],\n    \"transactions\": [...],\n    \"subtransactions\": [...],\n    \"scheduled_transactions\": [...],\n    \"scheduled_subtransactions\": [...]\n  }\n}"
    }
  ]
}
```

## Account Management Tools

### list_accounts

Lists all accounts for a specific budget.

**Parameters:**
- `budget_id` (string, required): The ID of the budget

**Example Request:**
```json
{
  "name": "list_accounts",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012"
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"accounts\": [\n    {\n      \"id\": \"87654321-4321-4321-4321-210987654321\",\n      \"name\": \"Checking Account\",\n      \"type\": \"checking\",\n      \"on_budget\": true,\n      \"closed\": false,\n      \"note\": null,\n      \"balance\": 150000,\n      \"cleared_balance\": 145000,\n      \"uncleared_balance\": 5000,\n      \"transfer_payee_id\": \"transfer-payee-id\",\n      \"direct_import_linked\": false,\n      \"direct_import_in_error\": false,\n      \"last_reconciled_at\": null,\n      \"debt_original_balance\": null,\n      \"debt_interest_rates\": {},\n      \"debt_minimum_payments\": {},\n      \"debt_escrow_amounts\": {}\n    }\n  ]\n}"
    }
  ]
}
```

### get_account

Gets detailed information for a specific account.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `account_id` (string, required): The ID of the account

**Example Request:**
```json
{
  "name": "get_account",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321"
  }
}
```

### create_account

Creates a new account in the specified budget.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `name` (string, required): The name of the new account
- `type` (string, required): The account type. Valid values:
  - `checking` - Checking account
  - `savings` - Savings account
  - `creditCard` - Credit card account
  - `cash` - Cash account
  - `lineOfCredit` - Line of credit
  - `otherAsset` - Other asset account
  - `otherLiability` - Other liability account
- `balance` (number, optional): Initial balance in milliunits
- `dry_run` (boolean, optional): Validate and return simulated result; no API call

**Example Request:**
```json
{
  "name": "create_account",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "name": "New Savings Account",
    "type": "savings",
    "balance": 100000
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"account\": {\n    \"id\": \"new-account-id\",\n    \"name\": \"New Savings Account\",\n    \"type\": \"savings\",\n    \"on_budget\": true,\n    \"closed\": false,\n    \"balance\": 100000,\n    \"cleared_balance\": 100000,\n    \"uncleared_balance\": 0\n  }\n}"
    }
  ]
}
```

## Transaction Management Tools

### list_transactions

Lists transactions for a budget with optional filtering.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `account_id` (string, optional): Filter by account ID
- `category_id` (string, optional): Filter by category ID
- `since_date` (string, optional): Only return transactions on or after this date (YYYY-MM-DD)
- `type` (string, optional): Filter by transaction type (`uncategorized` or `unapproved`)

**Example Request:**
```json
{
  "name": "list_transactions",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "since_date": "2024-01-01"
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"transactions\": [\n    {\n      \"id\": \"transaction-id\",\n      \"date\": \"2024-01-15\",\n      \"amount\": -5000,\n      \"memo\": \"Coffee shop\",\n      \"cleared\": \"cleared\",\n      \"approved\": true,\n      \"flag_color\": null,\n      \"account_id\": \"87654321-4321-4321-4321-210987654321\",\n      \"payee_id\": \"payee-id\",\n      \"category_id\": \"category-id\",\n      \"transfer_account_id\": null,\n      \"transfer_transaction_id\": null,\n      \"matched_transaction_id\": null,\n      \"import_id\": null,\n      \"import_payee_name\": null,\n      \"import_payee_name_original\": null,\n      \"debt_transaction_type\": null,\n      \"deleted\": false\n    }\n  ]\n}"
    }
  ]
}
```

### export_transactions

Exports all transactions to a JSON file with descriptive filename and platform-specific default paths. This tool bypasses MCP response size limits by saving data to a file instead of returning it in the response.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `account_id` (string, optional): Filter by account ID
- `category_id` (string, optional): Filter by category ID
- `since_date` (string, optional): Only export transactions on or after this date (YYYY-MM-DD)
- `type` (string, optional): Filter by transaction type (`uncategorized` or `unapproved`)
- `filename` (string, optional): Custom filename (auto-generated if not provided)
- `minimal` (boolean, optional): Export only essential fields for smaller files (default: true)

**Example Request:**
```json
{
  "name": "export_transactions",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "since_date": "2024-01-01"
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"message\": \"Successfully exported 1247 transactions\",\n  \"filename\": \"ynab_since_2024-01-01_1247items_2024-09-10_14-30-15.json\",\n  \"full_path\": \"C:\\\\Users\\\\YourName\\\\Downloads\\\\ynab_since_2024-01-01_1247items_2024-09-10_14-30-15.json\",\n  \"export_directory\": \"C:\\\\Users\\\\YourName\\\\Downloads\",\n  \"filename_explanation\": \"Filename format: ynab_{filters}_{count}items_{timestamp}.json - identifies what data was exported, when, and how many transactions\",\n  \"preview_count\": 10,\n  \"total_count\": 1247,\n  \"preview_transactions\": [\n    {\n      \"id\": \"transaction-id\",\n      \"date\": \"2024-01-15\",\n      \"amount\": -5000,\n      \"memo\": \"Coffee shop\",\n      \"payee_name\": \"Starbucks\",\n      \"category_name\": \"Dining Out\"\n    }\n  ]\n}"
    }
  ]
}
```

**Export File Structure:**
The exported JSON file contains:
- `export_info`: Metadata about the export (timestamp, filters, count, minimal flag)
- `transactions`: Array of transaction objects
  - **Minimal mode (default)**: `id`, `date`, `amount`, `payee_name`, `cleared`
  - **Full mode**: All available transaction fields

**Platform-Specific Default Paths:**
- Windows/Mac: `~/Downloads`
- Linux/Unix: `~/Documents` (or `$XDG_DOCUMENTS_DIR`)
- Configurable via `YNAB_EXPORT_PATH` environment variable

### compare_transactions

Compares bank transactions from CSV files with YNAB transactions to identify missing entries in either direction. This tool helps with bank statement reconciliation by finding transactions that exist in your bank statement but not in YNAB (need to import) or vice versa (double-check for duplicates).

**Parameters:**
- `budget_id` (string, required): The ID of the budget to compare against
- `account_id` (string, required): The ID of the account to compare transactions for
- `csv_file_path` (string, optional): Path to CSV file containing bank transactions
- `csv_data` (string, optional): CSV data as string (alternative to csv_file_path)
- `amount_tolerance` (number, optional): Amount difference tolerance as decimal (0.01 = 1%, default: 0.01)
- `date_tolerance_days` (number, optional): Date difference tolerance in days (default: 5)
- `csv_format` (object, optional): CSV format configuration
  - `date_column` (string): Column name for transaction date when `has_header: true`, or column index as string when `has_header: false` (default: "Date")
  - `amount_column` (string): Column name for transaction amount when `has_header: true`, or column index as string when `has_header: false` (default: "Amount")
  - `description_column` (string): Column name for transaction description when `has_header: true`, or column index as string when `has_header: false` (default: "Description")
  - `date_format` (string): Date format pattern (default: "MM/DD/YYYY")
  - `has_header` (boolean): Whether CSV has header row (default: true)
  - `delimiter` (string): CSV delimiter character (default: ",")

**Example Request (CSV data):**
```json
{
  "name": "compare_transactions",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "csv_data": "Date,Amount,Description\n2024-01-01,100.00,Coffee Shop\n2024-01-02,-50.25,Gas Station\n2024-01-03,25.00,ATM Withdrawal"
  }
}
```

**Example Request (CSV file with custom format):**
```json
{
  "name": "compare_transactions",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "csv_file_path": "/path/to/bank-statement.csv",
    "csv_format": {
      "date_column": "Transaction Date",
      "amount_column": "Dollar Amount",
      "description_column": "Description",
      "date_format": "DD/MM/YYYY",
      "delimiter": ";",
      "has_header": true
    },
    "amount_tolerance": 0.02,
    "date_tolerance_days": 3
  }
}
```

**Example Request (CSV without headers using column indices):**
```json
{
  "name": "compare_transactions",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "csv_data": "2024-01-01,100.00,Coffee Shop\n2024-01-02,-15.50,ATM Fee\n2024-01-03,250.00,Paycheck",
    "csv_format": {
      "date_column": "0",
      "amount_column": "1",
      "description_column": "2",
      "date_format": "YYYY-MM-DD",
      "has_header": false,
      "delimiter": ","
    }
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"summary\": {\n    \"bank_transactions_count\": 15,\n    \"ynab_transactions_count\": 12,\n    \"matches_found\": 10,\n    \"missing_in_ynab\": 5,\n    \"missing_in_bank\": 2,\n    \"date_range\": {\n      \"start\": \"2024-01-01\",\n      \"end\": \"2024-01-15\"\n    },\n    \"parameters\": {\n      \"amount_tolerance\": 0.01,\n      \"date_tolerance_days\": 5\n    }\n  },\n  \"matches\": [\n    {\n      \"bank_date\": \"2024-01-01\",\n      \"bank_amount\": \"100.00\",\n      \"bank_description\": \"Coffee Shop\",\n      \"ynab_date\": \"2024-01-01\",\n      \"ynab_amount\": \"100.00\",\n      \"ynab_payee\": \"Starbucks\",\n      \"match_score\": 90,\n      \"match_reasons\": [\"Exact date match\", \"Exact amount match\"]\n    }\n  ],\n  \"missing_in_ynab\": [\n    {\n      \"date\": \"2024-01-03\",\n      \"amount\": \"25.00\",\n      \"description\": \"ATM Withdrawal\",\n      \"row_number\": 4\n    }\n  ],\n  \"missing_in_bank\": [\n    {\n      \"id\": \"transaction-xyz\",\n      \"date\": \"2024-01-02\",\n      \"amount\": \"-15.50\",\n      \"payee_name\": \"Coffee Bean\",\n      \"memo\": \"Morning coffee\",\n      \"cleared\": \"cleared\"\n    }\n  ]\n}"
    }
  ]
}
```

**Matching Algorithm:**
- **Date matching** (40 points max): Exact dates get full points, nearby dates get partial points
- **Amount matching** (50 points max): Exact amounts get full points, close amounts within tolerance get partial points
- **Description matching** (10 points max): Similarity between bank description and YNAB payee/memo
- **Smart Duplicate Handling**: Multiple transactions with identical amounts are matched using chronological order with chronology bonus (+15 points for same day, +10 for within 3 days)
- **Minimum match score**: 30 points required for a valid match

**Supported Date Formats:**
- `MM/DD/YYYY` or `M/D/YYYY` (default)
- `DD/MM/YYYY` or `D/M/YYYY`
- `YYYY-MM-DD` (ISO format)
- `MM-DD-YYYY`

**Use Cases:**
- **Bank reconciliation**: Find transactions missing from YNAB that need to be imported
- **Duplicate detection**: Identify YNAB transactions that don't appear in bank statements
- **Import verification**: Verify that imported transactions match your bank statement exactly
- **Data cleanup**: Find and resolve discrepancies between bank and YNAB data

### reconcile_account

Performs comprehensive account reconciliation with bank statement data, including automatic transaction creation, smart duplicate matching, automatic date adjustment, and exact balance matching.

**Parameters:**
- `budget_id` (string, required): The ID of the budget to reconcile
- `account_id` (string, required): The ID of the account to reconcile
- `csv_file_path` (string, optional): Path to CSV file containing bank transactions
- `csv_data` (string, optional): CSV data as string (alternative to csv_file_path)
- `expected_bank_balance` (number, optional): Current bank account balance in dollars for verification
- `auto_create_transactions` (boolean, optional): Automatically create missing transactions in YNAB (default: false)
- `auto_update_cleared_status` (boolean, optional): Automatically mark matched transactions as cleared (default: false)
- `auto_unclear_missing` (boolean, optional): Automatically unmark cleared transactions missing from bank (default: true)
- `auto_adjust_dates` (boolean, optional): Automatically adjust YNAB dates to match bank processing dates (default: false)
- `start_date` (string, optional): Start date for reconciliation period (YYYY-MM-DD)
- `end_date` (string, optional): End date for reconciliation period (YYYY-MM-DD)
- `amount_tolerance` (number, optional): Amount difference tolerance as decimal (default: 0.01)
- `date_tolerance_days` (number, optional): Date difference tolerance in days (default: 5)
- `dry_run` (boolean, optional): Preview changes without applying them (default: true)
- `csv_format` (object, optional): CSV format configuration (same as compare_transactions)

**Key Features:**
- **Smart Duplicate Matching**: Handles multiple transactions with identical amounts using chronological order
- **Automatic Date Adjustment**: Syncs YNAB dates with bank processing dates for perfect alignment
- **Exact Balance Matching**: Zero tolerance validation ensures perfect reconciliation
- **Comprehensive Actions**: Creates missing transactions, marks cleared status, adjusts dates automatically

**Example Request:**
```json
{
  "name": "reconcile_account",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "expected_bank_balance": 1234.56,
    "csv_data": "Date,Amount,Description\n2024-01-01,100.00,Coffee Shop\n2024-01-02,-50.25,Gas Station",
    "auto_create_transactions": true,
    "auto_update_cleared_status": true,
    "auto_adjust_dates": true,
    "dry_run": false
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"summary\": {\n    \"bank_transactions_count\": 15,\n    \"ynab_transactions_count\": 12,\n    \"matches_found\": 10,\n    \"missing_in_ynab\": 2,\n    \"missing_in_bank\": 1,\n    \"transactions_created\": 2,\n    \"transactions_updated\": 8,\n    \"dates_adjusted\": 3,\n    \"dry_run\": false\n  },\n  \"date_range\": {\n    \"start_date\": \"2024-01-01\",\n    \"end_date\": \"2024-01-15\",\n    \"bank_statement_range\": {\n      \"earliest_transaction\": \"2024-01-01\",\n      \"latest_transaction\": \"2024-01-15\"\n    },\n    \"ynab_data_range\": {\n      \"earliest_transaction\": \"2024-01-01\",\n      \"latest_transaction\": \"2024-01-16\"\n    }\n  },\n  \"account_balance\": {\n    \"before\": {\n      \"balance\": 123456,\n      \"cleared_balance\": 100000,\n      \"uncleared_balance\": 23456\n    },\n    \"after\": {\n      \"balance\": 123456,\n      \"cleared_balance\": 123456,\n      \"uncleared_balance\": 0\n    }\n  },\n  \"balance_reconciliation\": {\n    \"expected_bank_balance\": 123456,\n    \"ynab_cleared_balance\": 123456,\n    \"difference\": 0,\n    \"reconciled\": true\n  },\n  \"actions_taken\": [\n    {\n      \"type\": \"create_transaction\",\n      \"transaction\": { \"id\": \"new-txn-123\", \"amount\": -5000 },\n      \"reason\": \"Created missing transaction: Gas Station\"\n    },\n    {\n      \"type\": \"update_transaction\",\n      \"transaction\": { \"id\": \"txn-456\", \"cleared\": \"cleared\" },\n      \"reason\": \"Updated transaction: marked as cleared, date adjusted from 2024-01-15 to 2024-01-16\"\n    }\n  ],\n  \"recommendations\": [\n    \"✅ Adjusted 3 transaction date(s) to match bank statement dates\",\n    \"✅ Balance reconciliation successful: Bank and YNAB cleared balances match!\"\n  ]\n}"
    }
  ]
}
```

### reconcile_account_v2

**NEW in v0.9.0** - Enhanced reconciliation with analysis-first approach and intelligent insights.

Performs analysis-only reconciliation (Phase 1) that matches bank transactions with YNAB transactions and provides actionable insights. Unlike `reconcile_account`, this tool focuses on understanding discrepancies before making changes.

**Parameters:**
- `budget_id` (string, required): The ID of the budget to reconcile
- `account_id` (string, required): The ID of the account to reconcile
- `csv_file_path` (string, optional): Path to CSV file containing bank transactions
- `csv_data` (string, optional): CSV data as string (alternative to csv_file_path)
- `statement_balance` (number, required): Expected cleared balance from bank statement in dollars
- `date_tolerance_days` (number, optional): Date difference tolerance in days (default: 2)
- `amount_tolerance_cents` (number, optional): Amount difference tolerance in cents (default: 1)
- `auto_match_threshold` (number, optional): Confidence threshold for auto-matching (default: 90)
- `suggestion_threshold` (number, optional): Confidence threshold for suggestions (default: 60)

**Key Features:**
- **Intelligent Insights**: Detects patterns like exact discrepancy matches, repeated amounts, and near-matches
- **High-Confidence Auto-Matching**: Transactions ≥90% confidence are marked for automatic clearing
- **Suggested Matches**: Medium confidence (60-89%) matches with alternatives to review
- **Pattern Detection**: Identifies repeated amounts, large unmatched transactions, and balance anomalies
- **Analysis-Only**: Phase 1 provides comprehensive analysis without making changes

**Example Request:**
```json
{
  "name": "reconcile_account_v2",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "csv_data": "Date,Description,Amount\n2025-10-20,Amazon,-23.47\n2025-10-22,Coffee Shop,-4.50\n2025-10-23,Grocery Store,-67.89",
    "statement_balance": -560.38,
    "date_tolerance_days": 2,
    "amount_tolerance_cents": 1
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"success\": true,\n  \"phase\": \"analysis\",\n  \"summary\": {\n    \"statement_date_range\": \"2025-10-20 to 2025-10-30\",\n    \"bank_transactions_count\": 7,\n    \"ynab_transactions_count\": 529,\n    \"auto_matched\": 5,\n    \"suggested_matches\": 1,\n    \"unmatched_bank\": 1,\n    \"unmatched_ynab\": 523,\n    \"current_cleared_balance\": 1745.40,\n    \"target_statement_balance\": -560.38,\n    \"discrepancy\": 2305.78,\n    \"discrepancy_explanation\": \"Need to clear 5 transactions, add 1 missing\"\n  },\n  \"auto_matches\": [...],\n  \"suggested_matches\": [...],\n  \"unmatched_bank\": [...],\n  \"balance_info\": {\n    \"current_cleared\": 1745.40,\n    \"current_uncleared\": -234.56,\n    \"current_total\": 1510.84,\n    \"target_statement\": -560.38,\n    \"discrepancy\": 2305.78,\n    \"on_track\": false\n  },\n  \"insights\": [\n    {\n      \"id\": \"balance-gap\",\n      \"type\": \"anomaly\",\n      \"severity\": \"critical\",\n      \"title\": \"Cleared balance off by $2,305.78\",\n      \"description\": \"YNAB cleared balance is $1,745.40 but the statement expects -$560.38. Focus on closing this gap.\",\n      \"evidence\": {\n        \"cleared_balance\": 1745.40,\n        \"statement_balance\": -560.38,\n        \"discrepancy\": 2305.78\n      }\n    },\n    {\n      \"id\": \"repeat-22.22\",\n      \"type\": \"repeat_amount\",\n      \"severity\": \"warning\",\n      \"title\": \"2 unmatched transactions at $22.22\",\n      \"description\": \"The bank statement shows 2 unmatched transaction(s) at $22.22. Repeated amounts are usually the quickest wins — reconcile these first.\",\n      \"evidence\": {\n        \"amount\": 22.22,\n        \"occurrences\": 2,\n        \"dates\": [\"2025-10-23\", \"2025-10-30\"]\n      }\n    }\n  ],\n  \"next_steps\": [\n    \"Review 5 auto-matched transactions for approval\",\n    \"Review 1 suggested matches and choose best match\",\n    \"Decide whether to add 1 missing bank transactions to YNAB\"\n  ]\n}"
    }
  ]
}
```

**Response Fields:**
- `success`: Always true for successful analysis
- `phase`: Always "analysis" for Phase 1
- `summary`: High-level statistics about the reconciliation
- `auto_matches`: High-confidence matches (≥90%) ready for automatic clearing
- `suggested_matches`: Medium-confidence matches (60-89%) that need review
- `unmatched_bank`: Bank transactions not found in YNAB
- `unmatched_ynab`: YNAB transactions not found in bank statement
- `balance_info`: Current and target balance information
- **`insights`**: Intelligent pattern detection and recommendations
  - `type`: "repeat_amount", "near_match", or "anomaly"
  - `severity`: "info", "warning", or "critical"
  - `title`: Short summary of the insight
  - `description`: Detailed explanation with actionable guidance
  - `evidence`: Supporting data for the insight
- `next_steps`: Ordered list of actions to complete reconciliation

**Insight Types:**
- **repeat_amount**: Multiple unmatched transactions with identical amounts (quick wins)
- **near_match**: Transactions that nearly matched but fell below threshold
- **anomaly**: Balance discrepancies, bulk unmatched transactions, or other anomalies

### get_transaction

Gets detailed information for a specific transaction.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `transaction_id` (string, required): The ID of the transaction

**Example Request:**
```json
{
  "name": "get_transaction",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "transaction_id": "transaction-id"
  }
}
```

### create_transaction

Creates a new transaction in the specified budget and account.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `account_id` (string, required): The ID of the account
- `amount` (number, required): Transaction amount in milliunits (negative for outflows)
- `date` (string, required): Transaction date in ISO format (YYYY-MM-DD)
- `payee_name` (string, optional): The payee name
- `payee_id` (string, optional): The payee ID
- `category_id` (string, optional): The category ID
- `memo` (string, optional): Transaction memo
- `cleared` (string, optional): Transaction cleared status (`cleared`, `uncleared`, `reconciled`)
- `approved` (boolean, optional): Whether the transaction is approved
- `flag_color` (string, optional): Transaction flag color (`red`, `orange`, `yellow`, `green`, `blue`, `purple`)
- `dry_run` (boolean, optional): Validate and return simulated result; no API call
- `subtransactions` (array, optional): Split line items; each entry accepts `amount` (milliunits), plus optional `memo`, `category_id`, `payee_id`, and `payee_name`

When `subtransactions` are supplied, their `amount` values must sum to the parent `amount`, matching YNAB API requirements.

**Example Request:**
```json
{
  "name": "create_transaction",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "amount": -5000,
    "date": "2024-01-15",
    "payee_name": "Coffee Shop",
    "category_id": "category-id",
    "memo": "Morning coffee",
    "cleared": "cleared",
    "approved": true
  }
}
```

**Split Transaction Example:**
```json
{
  "name": "create_transaction",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "amount": -125000,
    "date": "2024-02-01",
    "memo": "Rent and utilities",
    "subtransactions": [
      { "amount": -100000, "category_id": "rent-category", "memo": "Rent" },
      { "amount": -25000, "category_id": "utilities-category", "memo": "Utilities" }
    ]
  }
}
```

### create_receipt_split_transaction

Creates a split transaction from categorized receipt data and allocates taxes proportionally across the selected categories. Use this helper after the user has confirmed the receipt breakdown and category assignments.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `account_id` (string, required): The ID of the account
- `payee_name` (string, required): Payee to assign to the transaction (e.g., the store name)
- `date` (string, optional): Transaction date in ISO format (defaults to today when omitted)
- `memo` (string, optional): Memo applied to the parent transaction
- `receipt_subtotal` (number, optional): Pre-tax subtotal for validation (calculated automatically if omitted)
- `receipt_tax` (number, required): Total tax collected on the receipt
- `receipt_total` (number, required): Final total including tax
- `categories` (array, required): Categorized line items. Each entry accepts:
  - `category_id` (string, required)
  - `category_name` (string, optional, used for tax memo labels)
  - `items` (array, required): Each item includes `name` (string), `amount` (number), optional `quantity` (number), and optional `memo` (string)
- `cleared` (string, optional): Cleared status (`cleared`, `uncleared`, `reconciled`). Defaults to `uncleared`
- `approved` (boolean, optional): Whether the transaction should be marked approved
- `flag_color` (string, optional): Flag color (`red`, `orange`, `yellow`, `green`, `blue`, `purple`)
- `dry_run` (boolean, optional): When true, returns a preview without calling YNAB

**Example Request:**
```json
{
  "name": "create_receipt_split_transaction",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "account_id": "87654321-4321-4321-4321-210987654321",
    "payee_name": "IKEA",
    "date": "2025-10-13",
    "memo": "Receipt import",
    "receipt_subtotal": 112.34,
    "receipt_tax": 11.84,
    "receipt_total": 124.18,
    "categories": [
      {
        "category_id": "baby-stuff",
        "category_name": "Baby Stuff",
        "items": [
          { "name": "Crib pillow", "amount": 12.99 },
          { "name": "Bed linen", "amount": 24.99 }
        ]
      },
      {
        "category_id": "home-maintenance",
        "category_name": "Home Maintenance",
        "items": [
          { "name": "Teapot", "amount": 19.99 },
          { "name": "Toothbrush holder", "amount": 3.99 }
        ]
      }
    ]
  }
}
```

**Example Response:**
```json
{
  "transaction": {
    "id": "new-transaction-456",
    "amount": -124.18,
    "payee_name": "IKEA",
    "cleared": "uncleared",
    "subtransactions": [
      { "memo": "Crib pillow", "amount": -12.99, "category_id": "baby-stuff" },
      { "memo": "Bed linen", "amount": -24.99, "category_id": "baby-stuff" },
      { "memo": "Tax - Baby Stuff", "amount": -6.11, "category_id": "baby-stuff" },
      { "memo": "Teapot", "amount": -19.99, "category_id": "home-maintenance" },
      { "memo": "Toothbrush holder", "amount": -3.99, "category_id": "home-maintenance" },
      { "memo": "Tax - Home Maintenance", "amount": -5.99, "category_id": "home-maintenance" }
    ],
    "account_balance": 2534.87,
    "account_cleared_balance": 2450.22
  },
  "receipt_summary": {
    "subtotal": 112.34,
    "tax": 11.84,
    "total": 124.18,
    "categories": [
      {
        "category_id": "baby-stuff",
        "category_name": "Baby Stuff",
        "subtotal": 37.98,
        "tax": 6.11,
        "total": 44.09
      },
      {
        "category_id": "home-maintenance",
        "category_name": "Home Maintenance",
        "subtotal": 74.36,
        "tax": 5.73,
        "total": 80.09
      }
    ]
  }
}
```

### update_transaction

Updates an existing transaction.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `transaction_id` (string, required): The ID of the transaction to update
- `account_id` (string, optional): Update the account ID
- `amount` (number, optional): Update the amount in milliunits
- `date` (string, optional): Update the date (YYYY-MM-DD)
- `payee_name` (string, optional): Update the payee name
- `payee_id` (string, optional): Update the payee ID
- `category_id` (string, optional): Update the category ID
- `memo` (string, optional): Update the memo
- `cleared` (string, optional): Update the cleared status
- `approved` (boolean, optional): Update the approved status
- `flag_color` (string, optional): Update the flag color
- `dry_run` (boolean, optional): Validate and return simulated result; no API call

**Example Request:**
```json
{
  "name": "update_transaction",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "transaction_id": "transaction-id",
    "amount": -6000,
    "memo": "Updated memo",
    "flag_color": "red"
  }
}
```

### delete_transaction

Deletes a transaction from the specified budget.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `transaction_id` (string, required): The ID of the transaction to delete
- `dry_run` (boolean, optional): Validate and return simulated result; no API call

**Example Request:**
```json
{
  "name": "delete_transaction",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "transaction_id": "transaction-id"
  }
}
```

## Category Management Tools

### list_categories

Lists all categories for a specific budget.

**Parameters:**
- `budget_id` (string, required): The ID of the budget

**Example Request:**
```json
{
  "name": "list_categories",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012"
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"category_groups\": [\n    {\n      \"id\": \"group-id\",\n      \"name\": \"Monthly Bills\",\n      \"hidden\": false,\n      \"deleted\": false,\n      \"categories\": [\n        {\n          \"id\": \"category-id\",\n          \"category_group_id\": \"group-id\",\n          \"name\": \"Rent/Mortgage\",\n          \"hidden\": false,\n          \"original_category_group_id\": null,\n          \"note\": null,\n          \"budgeted\": 150000,\n          \"activity\": -150000,\n          \"balance\": 0,\n          \"goal_type\": null,\n          \"goal_creation_month\": null,\n          \"goal_target\": null,\n          \"goal_target_month\": null,\n          \"goal_percentage_complete\": null,\n          \"goal_months_to_budget\": null,\n          \"goal_under_funded\": null,\n          \"goal_overall_funded\": null,\n          \"goal_overall_left\": null,\n          \"deleted\": false\n        }\n      ]\n    }\n  ]\n}"
    }
  ]
}
```

### get_category

Gets detailed information for a specific category.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `category_id` (string, required): The ID of the category

### update_category

Updates the budgeted amount for a category in the current month.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `category_id` (string, required): The ID of the category
- `budgeted` (number, required): The budgeted amount in milliunits
- `dry_run` (boolean, optional): Validate and return simulated result; no API call

**Example Request:**
```json
{
  "name": "update_category",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "category_id": "category-id",
    "budgeted": 50000
  }
}
```

## Payee Management Tools

### list_payees

Lists all payees for a specific budget.

**Parameters:**
- `budget_id` (string, required): The ID of the budget

**Example Request:**
```json
{
  "name": "list_payees",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012"
  }
}
```

### get_payee

Gets detailed information for a specific payee.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `payee_id` (string, required): The ID of the payee

## Monthly Data Tools

### get_month

Gets budget data for a specific month.

**Parameters:**
- `budget_id` (string, required): The ID of the budget
- `month` (string, required): The month in ISO format (YYYY-MM-DD, typically first day of month)

**Example Request:**
```json
{
  "name": "get_month",
  "arguments": {
    "budget_id": "12345678-1234-1234-1234-123456789012",
    "month": "2024-01-01"
  }
}
```

### list_months

Lists all months summary data for a budget.

**Parameters:**
- `budget_id` (string, required): The ID of the budget

## Financial Analysis Tools

### financial_overview

Provides comprehensive multi-month financial analysis with statistical spending trends, budget optimization insights, and AI-generated recommendations. Uses linear regression for trend analysis and provides confidence scores for reliability.

**Parameters:**
- `budget_id` (string, optional): Budget ID (uses default budget if not specified)
- `months` (number, optional): Number of months to analyze (1-12, default: 3)
- `include_trends` (boolean, optional): Include spending trends analysis (default: true)
- `include_insights` (boolean, optional): Include AI-generated financial insights (default: true)

**Example Request:**
```json
{
  "name": "financial_overview",
  "arguments": {
    "months": 6,
    "include_trends": true,
    "include_insights": true
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"summary\": {\n    \"period\": \"6 months\",\n    \"budget_name\": \"My Budget\",\n    \"net_worth\": 15420.50,\n    \"liquid_assets\": 8500.25,\n    \"debt\": 2340.75\n  },\n  \"current_month\": {\n    \"income\": 5000000,\n    \"budgeted\": 4500000,\n    \"activity\": -4200000,\n    \"budget_utilization\": 93.3\n  },\n  \"spending_trends\": {\n    \"analysis_method\": \"Linear regression analysis over available months of spending data\",\n    \"explanation\": \"Trends are calculated using statistical linear regression to identify spending patterns. Categories need at least 3 months of spending data. Confidence scores indicate how reliable each trend is.\",\n    \"confidence_levels\": {\n      \"high\": \"70%+ confidence - strong, reliable trend\",\n      \"medium\": \"50-70% confidence - moderate trend\",\n      \"low\": \"below 50% confidence - weak or inconsistent trend\"\n    },\n    \"trends\": [\n      {\n        \"category\": \"Groceries\",\n        \"trend\": \"increasing\",\n        \"percentChange\": 15.2,\n        \"significance\": \"medium\",\n        \"explanation\": \"Based on 6 months of data, spending in Groceries has been increasing by 15.2% over the analysis period. This is a moderate trend (65% confidence).\",\n        \"data_points\": 6,\n        \"reliability_score\": 65\n      }\n    ]\n  },\n  \"insights\": [\n    {\n      \"type\": \"warning\",\n      \"title\": \"Overspent Categories Detected\",\n      \"description\": \"1 categories are currently overspent (Available balance negative).\",\n      \"impact\": \"high\",\n      \"actionable\": true,\n      \"suggestions\": [\"Move money from other categories\", \"Reduce spending in overspent categories\"]\n    },\n    {\n      \"type\": \"success\",\n      \"title\": \"Consistently Under-Spent Categories (Historical Pattern)\",\n      \"description\": \"3 categories show reliable decreasing spending trends over 6 months, suggesting budget reallocation opportunities.\",\n      \"impact\": \"medium\",\n      \"actionable\": true,\n      \"suggestions\": [\"Review if reduced spending reflects changed needs\", \"Consider reallocating excess budget to savings goals\"]\n    },\n    {\n      \"type\": \"info\",\n      \"title\": \"Categories Over Monthly Assignment (Current Month)\",\n      \"description\": \"2 categories spent more than assigned this month, but used available funds from previous months.\",\n      \"impact\": \"low\",\n      \"actionable\": true,\n      \"suggestions\": [\"This is normal if you carry funds forward from previous months\"]\n    }\n  ]\n}"
    }
  ]
}
```

#### Key Features & Improvements

**🔍 Accurate Overspending Detection**
- Correctly identifies overspending as when Available balance goes negative (balance < 0)
- Distinguishes between true overspending vs spending more than monthly assignment
- No longer incorrectly flags categories with positive Available balances

**📊 Statistical Spending Trends**
- Uses linear regression analysis across multiple months for reliable trend detection
- Provides confidence scores (0-100%) indicating trend reliability
- Requires minimum 3 months of data for meaningful analysis
- Clear explanations for each trend with statistical backing

**💡 Comprehensive Budget Optimization**
- **Historical Pattern Analysis**: Categories consistently under-spending over multiple months
- **Current Month Analysis**: Categories over monthly assignment but still have positive Available balance
- **Balance Analysis**: Categories with large unused funds that could be reallocated
- Clear labeling distinguishes between current-month vs historical patterns

### spending_analysis

Performs detailed spending analysis with category breakdowns, trends, and statistical variability metrics using coefficient of variation.

**Parameters:**
- `budget_id` (string, optional): Budget ID (uses default budget if not specified)
- `period_months` (number, optional): Analysis period in months (1-12, default: 6)
- `category_id` (string, optional): Focus analysis on specific category

**Example Request:**
```json
{
  "name": "spending_analysis",
  "arguments": {
    "period_months": 6,
    "category_id": "category-id-123"
  }
}
```


### budget_health_check

Performs comprehensive budget health assessment with scoring and actionable recommendations.

**Parameters:**
- `budget_id` (string, optional): Budget ID (uses default budget if not specified)  
- `include_recommendations` (boolean, optional): Include actionable recommendations (default: true)

**Example Request:**
```json
{
  "name": "budget_health_check",
  "arguments": {
    "include_recommendations": true
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"health_score\": 85,\n  \"score_explanation\": \"Good financial health with minor areas for improvement\",\n  \"metrics\": {\n    \"budget_utilization\": 93.3,\n    \"overspent_categories\": 2,\n    \"emergency_fund_status\": {\n      \"current_amount\": 2500.00,\n      \"status\": \"adequate\"\n    },\n    \"debt_to_asset_ratio\": 15.2\n  },\n  \"recommendations\": [\n    \"Address 2 overspent categories by moving funds or reducing spending\",\n    \"Consider building emergency fund to 6 months of expenses\"\n  ]\n}"
    }
  ]
}
```


## Utility Tools

### get_user

Gets information about the authenticated user.

**Parameters:** None

**Example Request:**
```json
{
  "name": "get_user",
  "arguments": {}
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"user\": {\n    \"id\": \"user-id\",\n    \"email\": \"user@example.com\",\n    \"trial_expires_on\": null,\n    \"subscription\": {\n      \"trial_expires_on\": null,\n      \"cancelled_at\": null,\n      \"date_first_current\": \"2020-01-01T00:00:00.000Z\",\n      \"frequency\": \"annually\"\n    }\n  }\n}"
    }
  ]
}
```

### convert_amount

Converts between dollars and milliunits with integer arithmetic for precision.

**Parameters:**
- `amount` (number, required): The amount to convert
- `to_milliunits` (boolean, required): If true, convert from dollars to milliunits. If false, convert from milliunits to dollars

**Example Request (dollars to milliunits):**
```json
{
  "name": "convert_amount",
  "arguments": {
    "amount": 50.25,
    "to_milliunits": true
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"original_amount\": 50.25,\n  \"converted_amount\": 50250,\n  \"conversion_type\": \"dollars_to_milliunits\"\n}"
    }
  ]
}
```

**Example Request (milliunits to dollars):**
```json
{
  "name": "convert_amount",
  "arguments": {
    "amount": 50250,
    "to_milliunits": false
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"original_amount\": 50250,\n  \"converted_amount\": 50.25,\n  \"conversion_type\": \"milliunits_to_dollars\"\n}"
    }
  ]
}
```

## Diagnostic Tools

These tools help inspect the server, environment, and performance. They do not modify YNAB data.

### diagnostic_info

Returns comprehensive diagnostic information about the MCP server with flexible parameter control.

**Parameters:**
- `include_memory` (boolean, optional): Include memory usage statistics (default: true)
- `include_environment` (boolean, optional): Include environment and token status (default: true)
- `include_server` (boolean, optional): Include server version and runtime info (default: true)
- `include_security` (boolean, optional): Include security and rate limiting stats (default: true)
- `include_cache` (boolean, optional): Include cache statistics (default: true)

**Example Request (all sections):**
```json
{
  "name": "diagnostic_info",
  "arguments": {}
}
```

**Example Request (selective sections):**
```json
{
  "name": "diagnostic_info",
  "arguments": {
    "include_memory": true,
    "include_server": true,
    "include_security": false,
    "include_cache": false,
    "include_environment": false
  }
}
```

**Example Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"timestamp\": \"2024-01-15T10:30:00.000Z\",\n  \"server\": {\n    \"name\": \"ynab-mcp-server\",\n    \"version\": \"0.6.0\",\n    \"node_version\": \"v20.10.0\",\n    \"platform\": \"win32\",\n    \"arch\": \"x64\",\n    \"pid\": 12345,\n    \"uptime_ms\": 3600000,\n    \"uptime_readable\": \"1h 0m 0s\",\n    \"env\": {\n      \"node_env\": \"development\",\n      \"minify_output\": \"true\"\n    }\n  },\n  \"memory\": {\n    \"rss_mb\": 45.2,\n    \"heap_used_mb\": 32.1,\n    \"heap_total_mb\": 40.5,\n    \"external_mb\": 2.1,\n    \"array_buffers_mb\": 0.5,\n    \"description\": {\n      \"rss\": \"Resident Set Size - total memory allocated for the process\",\n      \"heap_used\": \"Used heap memory (objects, closures, etc.)\",\n      \"heap_total\": \"Total heap memory allocated\",\n      \"external\": \"Memory used by C++ objects bound to JavaScript objects\",\n      \"array_buffers\": \"Memory allocated for ArrayBuffer and SharedArrayBuffer\"\n    }\n  },\n  \"environment\": {\n    \"token_present\": true,\n    \"token_length\": 64,\n    \"token_preview\": \"abcd...xyz\",\n    \"ynab_env_keys_present\": [\"YNAB_ACCESS_TOKEN\"],\n    \"working_directory\": \"/path/to/project\"\n  },\n  \"security\": {\n    \"requests_processed\": 1250,\n    \"rate_limit_hits\": 0,\n    \"errors_logged\": 2\n  },\n  \"cache\": {\n    \"entries\": 15,\n    \"estimated_size_kb\": 128,\n    \"keys\": [\"budget_123\", \"account_456\"]\n  }\n}"
    }
  ]
}
```

### clear_cache

Clears the in-memory cache. Safe; does not modify YNAB data.

**Parameters:** None

Example Request:
```json
{ "name": "clear_cache", "arguments": {} }
```

### set_output_format

Configures default JSON formatting for responses.

Parameters:
- `default_minify` (boolean, optional): Minify JSON outputs by default (default: true)
- `pretty_spaces` (number, optional): Spaces to use when pretty-printing (0-10)

Example Request:
```json
{ "name": "set_output_format", "arguments": { "default_minify": false, "pretty_spaces": 2 } }
```

## Error Handling

All tools implement comprehensive error handling with consistent error response formats.

### Error Response Format

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"error\": {\n    \"code\": \"ERROR_CODE\",\n    \"message\": \"Human-readable error message\",\n    \"tool\": \"tool_name\",\n    \"operation\": \"operation_description\"\n  }\n}"
    }
  ]
}
```

### Common Error Types

#### Authentication Errors (401)

**Cause**: Invalid or expired YNAB access token

**Example Response:**
```json
{
  "error": {
    "code": "AUTHENTICATION_ERROR",
    "message": "Invalid or expired YNAB access token. Please check your YNAB_ACCESS_TOKEN environment variable.",
    "tool": "list_budgets",
    "operation": "listing budgets"
  }
}
```

**Solutions:**
- Verify the `YNAB_ACCESS_TOKEN` environment variable is set correctly
- Check if the token has expired in YNAB Developer Settings
- Generate a new token if necessary

#### Authorization Errors (403)

**Cause**: Insufficient permissions for the requested operation

**Example Response:**
```json
{
  "error": {
    "code": "AUTHORIZATION_ERROR",
    "message": "Insufficient permissions to access this resource.",
    "tool": "get_budget",
    "operation": "retrieving budget details"
  }
}
```

#### Resource Not Found (404)

**Cause**: Invalid budget_id, account_id, transaction_id, etc.

**Example Response:**
```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found. Please verify the ID is correct.",
    "tool": "get_account",
    "operation": "retrieving account details"
  }
}
```

**Solutions:**
- Verify the ID is correct and exists
- Use list operations to find valid IDs
- Check if the resource has been deleted

#### Rate Limiting (429)

**Cause**: Too many requests to YNAB API

**Example Response:**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please wait before making more requests.",
    "tool": "list_transactions",
    "operation": "listing transactions"
  }
}
```

**Solutions:**
- Wait before making additional requests
- Implement exponential backoff in your client
- Reduce the frequency of API calls

#### Validation Errors

**Cause**: Invalid parameters provided to tools

**Example Response:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid parameters: date must be in ISO format (YYYY-MM-DD)",
    "tool": "create_transaction",
    "operation": "creating transaction"
  }
}
```

**Solutions:**
- Check parameter formats and types
- Refer to the tool documentation for valid values
- Ensure required parameters are provided

#### Server Errors (500)

**Cause**: YNAB service issues or internal server errors

**Example Response:**
```json
{
  "error": {
    "code": "SERVER_ERROR",
    "message": "An internal server error occurred. Please try again later.",
    "tool": "get_budget",
    "operation": "retrieving budget details"
  }
}
```

**Solutions:**
- Retry the request after a short delay
- Check YNAB service status
- Contact support if the issue persists

## Best Practices

### 1. Error Handling

Always handle errors gracefully in your client applications:

```javascript
try {
  const result = await mcpClient.callTool('list_budgets', {});
  // Process successful result
} catch (error) {
  // Handle error based on error code
  if (error.code === 'AUTHENTICATION_ERROR') {
    // Prompt user to update token
  } else if (error.code === 'RATE_LIMIT_EXCEEDED') {
    // Implement retry with backoff
  }
}
```

### 2. Parameter Validation

Validate parameters before making tool calls:

```javascript
// Validate date format
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRegex.test(date)) {
  throw new Error('Date must be in YYYY-MM-DD format');
}

// Validate amount is in milliunits
if (!Number.isInteger(amount)) {
  throw new Error('Amount must be an integer in milliunits');
}
```

### 3. Efficient Data Retrieval

Use filtering parameters to reduce data transfer:

```javascript
// Instead of getting all transactions and filtering client-side
const allTransactions = await mcpClient.callTool('list_transactions', {
  budget_id: budgetId
});

// Use server-side filtering
const recentTransactions = await mcpClient.callTool('list_transactions', {
  budget_id: budgetId,
  since_date: '2024-01-01',
  account_id: specificAccountId
});
```

### 4. Amount Conversions

Use the conversion utility for user-friendly displays:

```javascript
// Convert milliunits to dollars for display
const dollarsResult = await mcpClient.callTool('convert_amount', {
  amount: 50250,
  to_milliunits: false
});
console.log(`Amount: $${dollarsResult.converted_amount}`); // Amount: $50.25

// Convert user input to milliunits for API calls
const milliUnitsResult = await mcpClient.callTool('convert_amount', {
  amount: 50.25,
  to_milliunits: true
});
// Use milliUnitsResult.converted_amount in transaction creation
```

### 5. Caching Strategies

Cache relatively static data to improve performance:

```javascript
// Cache budget and account information
const budgets = await mcpClient.callTool('list_budgets', {});
// Cache for 1 hour

const accounts = await mcpClient.callTool('list_accounts', {
  budget_id: budgetId
});
// Cache for 30 minutes

// Don't cache frequently changing data like transactions
const transactions = await mcpClient.callTool('list_transactions', {
  budget_id: budgetId,
  since_date: today
});
// Always fetch fresh
```

This API reference provides comprehensive documentation for all available tools. For additional information, see the [Developer Guide](DEVELOPER.md) for best practices and common usage patterns.

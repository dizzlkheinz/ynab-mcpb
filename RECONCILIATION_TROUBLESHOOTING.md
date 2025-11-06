# 🔧 Reconciliation Tool Troubleshooting Guide

## Quick Diagnosis

If your `reconcile_account` tool is failing with a "connectivity issue" or similar error, follow this guide to fix it.

## Root Causes Identified & Fixed

### Issue #1: Silent Error Suppression ✅ FIXED

**Problem**: When the CSV comparison fails internally, the actual error is hidden behind generic messages.

**Fix Applied**: Added explicit error catching and reporting with actionable suggestions.

### Issue #2: CSV Format Mismatch ✅ FIXED

**Problem**: If your bank's CSV format doesn't match the default format expectations, the tool fails silently.

**Fix Applied**: Enabled automatic CSV format detection by default when format isn't explicitly provided.

### Issue #3: Type-Safety Issues ✅ FIXED

**Problem**: The tool assumed specific data structures from the comparison result, causing crashes if structure was different.

**Fix Applied**: Added proper type casting and null-safe access to all comparison data.

---

## How to Use Reconciliation Now

### Step 1: Prepare Your Bank CSV

Export your bank statement as CSV from TD Canada Trust. Your CSV should have columns like:

- Date
- Description/Merchant
- Amount OR Debit/Credit columns

### Step 2: Run Reconciliation with Proper Settings

#### **Option A: Automatic Format Detection (Recommended)**

```
Ask Claude:
"Reconcile my [ACCOUNT_NAME] account with this bank statement CSV.
Here's the ending balance: $899.02 (debit/owe)"

Then provide:
- Your budget ID or name
- Your account name
- The CSV file data
- The statement balance
```

The tool will now:

1. Auto-detect your CSV format
2. Parse transactions correctly
3. Compare with YNAB data
4. Show you discrepancies

#### **Option B: Manual Format Specification (If Auto-Detection Doesn't Work)**

```json
{
  "budget_id": "your-budget-id",
  "account_id": "your-account-id",
  "csv_data": "your CSV content",
  "csv_format": {
    "date_column": "Transaction Date",
    "debit_column": "Debit",
    "credit_column": "Credit",
    "description_column": "Description",
    "date_format": "MM/DD/YYYY",
    "delimiter": ",",
    "has_header": true
  },
  "bank_statement_balance": -899.02,
  "statement_date": "2025-10-15",
  "dry_run": true,
  "auto_detect_format": false
}
```

---

## Common Scenarios & Fixes

### Scenario 1: "CSV Comparison Failed"

**Cause**: CSV format doesn't match expectations.

**Fix**:

1. Check your CSV has a header row
2. Verify column names match your bank's format
3. Try with `auto_detect_format: true` (now default)
4. Ask Claude to analyze the CSV structure first

### Scenario 2: "No Valid Transactions Found"

**Cause**: CSV parsing failed or columns are named differently.

**Fix**:

```
Ask Claude:
"Can you analyze this CSV file and tell me:
1. What columns does it have?
2. What format are the dates in?
3. Which column has amounts (or debit/credit)?"
```

Then Claude can tell you the exact format to use.

### Scenario 3: "Failed to Parse Comparison Result"

**Cause**: CSV was parsed, but then something went wrong.

**Fix**:
This is rare now with the fixes. If it occurs:

1. Make sure your CSV has at least one valid transaction
2. Try a smaller CSV first (just 5-10 transactions)
3. Report the full error message

### Scenario 4: Balance Discrepancy

**Cause**: Bank balance doesn't match YNAB balance.

**Fix**:
The tool now provides:

- Exact discrepancy amount
- Likely causes (bank fees, pending transactions, etc.)
- Suggested resolutions
- Dual-channel responses (first entry is a human-friendly report, second is structured JSON that includes `csv_format` details and a `schema_url` pointing to the master-branch schema)

Example output:

```
Balance Discrepancy Found:
  Bank balance: -$899.02
  YNAB cleared balance: -$2,937.51
  Discrepancy: $2,038.49

Likely Cause: Round amount suggests bank fee or interest
```

---

## Enhanced Debugging Steps

### Step 1: Verify Your Setup

```bash
# In Claude Desktop, ask:
"Can you list my budgets and accounts?"
```

This confirms your token and data access work.

### Step 2: Analyze CSV First

```bash
# Before running full reconciliation, ask:
"Analyze this CSV file - what are the columns and format?"
```

Claude will tell you the exact structure.

### Step 3: Run in Dry-Run Mode

```bash
# Always start with dry_run: true (default)
# This shows what WOULD happen without making changes
```

### Step 4: Check Discrepancies

The reconciliation report now shows:

- ✅ Transactions that match perfectly
- ❌ Missing in YNAB (from bank statement)
- ❌ Missing in Bank (in YNAB but not on statement)
- 📊 Date range covered
- 💰 Balance verification status

### Step 5: Review Recommendations

The tool provides actionable recommendations:

- "Consider setting auto_create_transactions=true to create X missing transactions"
- "Consider setting auto_adjust_dates=true to align Y dates"
- "X transactions exist in YNAB but not in bank statement"

---

## Your TD Visa Reconciliation Case

### Your Setup:

- **Budget**: 2025
- **Account**: K TD FCT VISA
- **Current YNAB Balance**: -$2,937.51
- **Bank Statement Balance**: -$899.02
- **Discrepancy**: $2,038.49

### Why It Was Failing:

1. CSV format auto-detection was disabled
2. Error messages were hidden
3. The tool had type-safety issues

### How to Fix It Now:

```
"I want to reconcile my K TD FCT VISA account with my October bank statement.

Bank statement ending balance: $899.02 (I owe $899.02)
Statement date: October 15, 2025

Here's the CSV data..."
```

Claude will now:

1. Auto-detect your CSV format
2. Compare your 80 YNAB transactions with the bank CSV
3. Show you exactly which transactions don't match
4. Provide clear recommendations

---

## CSV Format Examples

### TD Canada Trust Example (Debit/Credit Columns):

```
Date,Description,Debit,Credit
2025-10-01,GROCERIES,50.00,
2025-10-02,SALARY DEPOSIT,,2500.00
2025-10-03,GAS STATION,45.50,
```

### Alternative Format (Single Amount Column):

```
Transaction Date,Merchant,Amount
2025-10-01,GROCERIES,-50.00
2025-10-02,SALARY DEPOSIT,2500.00
2025-10-03,GAS STATION,-45.50
```

### With Negative Amounts (Credit Card Format):

```
Date,Description,Amount
2025-10-01,GROCERIES,-50.00
2025-10-02,PAYMENT,-899.02
2025-10-03,GAS STATION,-45.50
```

---

## Advanced Usage

### Auto-Create Missing Transactions:

```
After dry-run review, ask:
"Now actually create the missing transactions using auto_create_transactions: true"
```

### Auto-Update Cleared Status:

```
"Update the cleared status for matched transactions using auto_update_cleared_status: true"
```

### Adjust Transaction Dates:

```
"Adjust transaction dates to match the bank statement using auto_adjust_dates: true"
```

### All-In-One Reconciliation:

```
"Perform full reconciliation with:
- auto_create_transactions: true
- auto_update_cleared_status: true
- auto_adjust_dates: true
- dry_run: false"
```

⚠️ **Warning**: Only set `dry_run: false` after reviewing the dry-run results!

---

## Error Recovery

If reconciliation fails:

1. **Check error message** - Now more descriptive
2. **Verify CSV format** - Ask Claude to analyze it
3. **Try auto-detection** - Usually works now
4. **Check transaction dates** - Make sure they're valid
5. **Verify amounts** - Make sure they're numeric

---

## Performance Tips

1. **Dry-run first**: Always check dry-run results before executing
2. **Smaller batches**: Start with recent transactions (30 days)
3. **Clean CSV**: Remove headers that don't match column names
4. **Recent statements**: Focus on current month/quarter

---

## What's Different Now

### Before (What Was Breaking):

```
User → reconcile_account
    ↓
    → compare_transactions (fails silently)
    ↓
    → "connectivity issue" 😞
```

### After (What Works Now):

```
User → reconcile_account (with CSV)
    ↓
    → Auto-detects CSV format ✅
    ↓
    → compare_transactions (with proper format)
    ↓
    → Compare & match transactions ✅
    ↓
    → Detailed report with:
        - Matched transactions
        - Missing transactions
        - Balance verification
        - Actionable recommendations ✅
```

---

## Next Steps

1. **Try it**: Ask Claude to reconcile your TD Visa with your October statement
2. **Review**: Check the dry-run results carefully
3. **Execute**: If results look good, set `dry_run: false`
4. **Verify**: Check YNAB to confirm changes were made correctly

---

## Support

If you still encounter issues:

1. **Collect information**:
   - Your CSV (sanitized)
   - The error message (full text)
   - Your account balance discrepancy

2. **Ask Claude**:
   - "Why is my reconciliation failing?"
   - "Can you analyze my CSV format?"
   - "What does this error mean?"

3. **Check YNAB Status**: https://status.youneedabudget.com

---

## Version Info

- **Tool**: reconcile_account v1.0+
- **CSV Comparison**: compare_transactions with auto-detection
- **Error Handling**: Enhanced with clear, actionable messages
- **Type Safety**: Improved with proper null checks

Last updated: 2025-10-15

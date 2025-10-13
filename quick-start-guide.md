# Quick Start: Testing YNAB MCP Server with Claude Desktop

This guide provides the fastest path to test the YNAB MCP server with Claude Desktop integration.

## Prerequisites

1. **YNAB Account**: Active YNAB subscription with transaction data
2. **YNAB Token**: Personal Access Token from [YNAB developer settings](https://app.youneedabudget.com/settings/developer)
3. **Node.js**: Version 18.0.0 or higher (`node --version`)
4. **Claude Desktop**: Latest version installed

## Step 1: Environment Setup

# Then open .env in your editor and add/update:
- `LOG_LEVEL=debug` (for detailed testing logs)
- `YNAB_EXPORT_PATH=./test-exports` (for testing exports)
## Step 2: Build and Test

```bash
# Build the project
npm run build

# Run tests to verify everything works
npm test

# Quick test of the server locally (optional)
npm run start
# Press Ctrl+C to stop after verifying it starts
```

**Expected Results**:
- Build completes without TypeScript errors
- All tests pass
- Server starts without connection errors

## Step 3: Claude Desktop Integration

### Option A: Local Development Server (Recommended for Testing)

1. **Configure Claude Desktop**:
   - Open Claude Desktop Settings
   - Navigate to "Extensions" or "MCP Servers" section
   - Add new server with these settings:
     - **Name**: `ynab-mcp-server`
     - **Command**: `node`
     - **Arguments**: `["dist/index.js"]`
     - **Working Directory**: `/path/to/ynab-mcp-dxt`
     - **Environment Variables**:
       ```json
       {
         "YNAB_ACCESS_TOKEN": "your_actual_token_here"
       }
       ```

2. **Restart Claude Desktop** completely (close and reopen)

### Option B: DXT Package (Alternative)

```bash
# Build DXT package
npm run package:dxt

# The .dxt file will be created in dist/
# Drag and drop it into Claude Desktop
# Configure YNAB_ACCESS_TOKEN in extension settings
```

## Step 4: Basic Testing (2 minutes)

### 4.1 Verify Connection
**Ask Claude**:
```
Can you run the diagnostic_info tool for the YNAB MCP server?
```

**Expected**: Should return server status, cache configuration, and authentication details.

### 4.2 Test Budget Access
**Ask Claude**:
```
Can you list my YNAB budgets using the list_budgets tool?
```

**Expected**: Should return your budget(s) with names and IDs.

### 4.3 Set Default Budget
**Ask Claude**:
```
Set my default budget to [your_budget_name] using the set_default_budget tool.
```

**Expected**: Should confirm success and mention cache warming.

### 4.4 Test Cache Performance
**Ask Claude**:
```
List my accounts using the list_accounts tool.
```
Then immediately ask again:
```
List my accounts again.
```

**Expected**: Second request should be noticeably faster due to caching.

## Step 5: Advanced Testing (5 minutes)

### 5.1 Financial Analysis
**Ask Claude**:
```
Give me a financial overview for the last 3 months using the financial_overview tool.
```

**Expected**: Comprehensive analysis with trends, insights, and spending patterns.

### 5.2 Transaction Management
**Ask Claude**:
```
Show me my recent transactions using the list_transactions tool.
```

**Expected**: List of recent transactions with details.

### 5.3 Export Testing
**Ask Claude**:
```
Export my transactions to a file using the export_transactions tool.
```

**Expected**: Creates a file in the test-exports directory.

### 5.4 CSV Comparison Testing
**Ask Claude**:
```
Compare the CSV file test-csv-sample.csv with my YNAB transactions using the compare_transactions tool.
```

**Expected**: Analysis of matches and differences between CSV and YNAB data.

## Step 6: Performance Verification

### 6.1 Cache Testing
**Ask Claude**:
```
Run diagnostic_info again and show me the cache metrics.
```

**Expected**: Should show cache hits, entries, and performance metrics.

### 6.2 Repeat Operations
Run the same commands from Step 4 again and notice:
- Faster response times
- Improved cache hit ratios
- Consistent data accuracy

## Step 7: Troubleshooting Common Issues

### Issue: "Invalid or expired token"
**Solution**:
1. Check YNAB_ACCESS_TOKEN in .env file
2. Generate new token at [YNAB developer settings](https://app.youneedabudget.com/settings/developer)
3. Restart Claude Desktop after updating token

### Issue: "No default budget set"
**Solution**:
1. Use `set_default_budget` tool first
2. Or provide budget_id parameter to tools that need it

### Issue: Connection errors
**Solution**:
1. Verify Node.js version: `node --version` (should be 18+)
2. Verify build completed: check that `dist/index.js` exists
3. Check Claude Desktop logs for detailed error messages
4. Restart Claude Desktop completely

### Issue: Tools not available
**Solution**:
1. Verify server appears as "connected" in Claude Desktop
2. Check MCP server configuration in Claude Desktop settings
3. Ensure working directory path is correct

## Quick Verification Commands

```bash
# Check Node.js version
node --version

# Verify build exists
ls dist/index.js

# Test environment loading
node -r dotenv/config -e "console.log(process.env.YNAB_ACCESS_TOKEN ? 'Token configured' : 'Token missing')"

# Check test directory
ls test-exports
```

## Step 8: Success Indicators

You'll know the testing is successful when:

✅ **Connection**: Server shows as "connected" in Claude Desktop
✅ **Authentication**: diagnostic_info shows "authenticated: true"
✅ **Basic Functions**: Budget, account, and transaction tools work
✅ **Caching**: Repeated requests are faster (cache hits increase)
✅ **Analysis**: Financial tools provide insights and recommendations
✅ **Export**: Files are created in test-exports directory
✅ **Performance**: Response times are acceptable (< 2 seconds cached)

## Next Steps After Basic Testing

1. **Explore Financial Analysis**: Test spending_analysis and budget_health_check tools
2. **Transaction Management**: Try creating, updating, and deleting test transactions
3. **Advanced Features**: Test reconcile_account with bank statement data
4. **Performance Testing**: Run multiple concurrent requests
5. **Error Testing**: Try invalid parameters to test error handling

## Getting Help

- **Test Scenarios**: See `test-scenarios.md` for detailed test cases
- **Comprehensive Testing**: Use `testing-checklist.md` for systematic validation
- **Issues**: Check Claude Desktop logs and diagnostic_info output
- **Performance**: Monitor cache metrics in diagnostic_info

## Safety Notes

- **Test Transactions**: Remember to clean up any test transactions you create
- **Export Files**: Clean up test-exports directory as needed
- **Real Data**: Be careful when testing with production YNAB data

---

**Estimated Time**: 10-15 minutes for complete basic testing
**Prerequisites Time**: 5 minutes if environment is already set up
**Success Rate**: High when following this guide step by step

The YNAB MCP server v0.8.1 includes split-transaction support, enhanced caching, improved performance, and comprehensive financial analysis tools. This quick start gets you testing immediately while the detailed documentation provides comprehensive validation.

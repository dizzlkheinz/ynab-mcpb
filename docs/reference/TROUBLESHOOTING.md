# YNAB MCP Server Troubleshooting Guide

Common issues, solutions, and debugging techniques for the YNAB MCP Server.

## Table of Contents

- [Common Issues](#common-issues)
- [Error Messages](#error-messages)
- [Connection Problems](#connection-problems)
- [Performance Issues](#performance-issues)
- [Data Issues](#data-issues)
- [Debug Techniques](#debug-techniques)

## Common Issues

### 1. Invalid or Expired YNAB Access Token

**Symptoms**: 401 authentication errors, "Invalid or expired token" messages

**Solutions**:
- Check if `YNAB_ACCESS_TOKEN` environment variable is set
- Verify token in YNAB Developer Settings
- Generate new token if expired
- Ensure token has no extra spaces or characters
- For Claude Desktop: Check extension settings for correct token configuration

**How to generate a new token**:
1. Log in to [YNAB Web App](https://app.youneedabudget.com)
2. Go to Account Settings → Developer Settings
3. Click "New Token"
4. Provide a descriptive name (e.g., "MCP Server")
5. Copy the generated token immediately (it's only shown once)
6. Add it to your `.env` file or Claude Desktop extension settings

### 2. Rate Limit Exceeded

**Symptoms**: 429 errors, especially during bulk operations

**Solutions**:
- Implement retry logic with exponential backoff
- Add delays between API calls
- Use batch processing with smaller batch sizes
- Leverage caching to reduce API calls
- The v0.8.x enhanced caching helps prevent rate limit issues

**Example retry logic**:
```javascript
async function withRetry(operation, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### 3. Resource Not Found

**Symptoms**: 404 errors when accessing budgets, accounts, or transactions

**Solutions**:
- Verify IDs are correct and current
- Check if resources have been deleted in YNAB
- Use list operations to discover valid IDs
- Handle deleted/hidden items in your code
- Ensure you're using the correct budget context

**Example ID verification**:
```javascript
// Always verify IDs exist before operations
const accounts = await client.callTool('list_accounts', { budget_id: budgetId });
const accountIds = accounts.accounts.map(a => a.id);
if (!accountIds.includes(targetAccountId)) {
  throw new Error(`Account ${targetAccountId} not found`);
}
```

### 4. Incorrect Transaction Amounts

**Symptoms**: Transactions appear with wrong amounts (off by factor of 1000)

**Solutions**:
- Always convert dollars to milliunits before API calls (multiply by 1000)
- Use the `convert_amount` tool for accuracy
- Remember negative amounts for outflows
- Consider account types (credit cards need negative amounts for payments)

**Conversion reference**:
```
$25.50 → 25500 milliunits
-$100.00 → -100000 milliunits
```

### 5. Date-Related Errors

**Symptoms**: Validation errors or unexpected behavior with dates

**Solutions**:
- Use ISO format (YYYY-MM-DD) for all dates
- Validate date format before API calls
- Consider timezone differences
- Use first day of month (YYYY-MM-01) for monthly operations

**Valid date formats**:
```javascript
// ✅ Correct
'2024-01-15'
'2024-12-31'

// ❌ Wrong
'01/15/2024'  // US format
'15-01-2024'  // European format
'2024-1-15'   // Missing zero padding
```

## Error Messages

### AUTHENTICATION_ERROR

**Meaning**: YNAB access token is invalid or expired

**Solution**: Generate a new token and update configuration

### AUTHORIZATION_ERROR

**Meaning**: Token doesn't have permission for requested operation

**Solution**: Verify token scope and permissions in YNAB settings

### VALIDATION_ERROR

**Meaning**: Input parameters are invalid or missing

**Solution**: Check parameter format, types, and required fields

### RATE_LIMIT_EXCEEDED

**Meaning**: Too many requests to YNAB API

**Solution**: Implement retry logic, add delays, use caching

### RESOURCE_NOT_FOUND

**Meaning**: Requested budget, account, or transaction doesn't exist

**Solution**: Verify IDs, check for deleted items, use list operations

### OPERATION_FAILED

**Meaning**: Generic operation failure

**Solution**: Check error details, verify data validity, check YNAB API status

## Connection Problems

### Server Won't Start

**Symptoms**: Server fails to start, immediate crash

**Diagnostics**:
```bash
# Check Node.js version (must be 18+)
node --version

# Verify build completed
ls dist/index.js

# Check for syntax errors
npm run type-check

# View detailed error logs
npm start 2>&1 | tee server.log
```

**Solutions**:
- Ensure Node.js 18+ is installed
- Run `npm install` to install dependencies
- Run `npm run build` to compile TypeScript
- Check environment variables are set correctly

### Claude Desktop Can't Connect

**Symptoms**: Server shows as disconnected in Claude Desktop

**Diagnostics**:
1. Check Claude Desktop logs for error messages
2. Verify MCP server configuration in settings
3. Confirm working directory path is correct
4. Check that `dist/index.js` exists

**Solutions**:
- Verify server configuration in Claude Desktop settings:
  - Command: `node`
  - Arguments: `["dist/index.js"]`
  - Working Directory: correct absolute path
- Restart Claude Desktop completely
- Check file permissions on dist directory
- Verify YNAB_ACCESS_TOKEN is set in extension settings

### Intermittent Connection Drops

**Symptoms**: Server disconnects randomly, reconnects after delay

**Diagnostics**:
```javascript
// Check diagnostic info for system health
const result = await client.callTool('diagnostic_info');
const diagnostics = JSON.parse(result.content[0].text);
console.log('Server Health:', diagnostics.diagnostics.server_info);
```

**Solutions**:
- Check system resource usage (CPU, memory)
- Review cache configuration (may need to reduce cache size)
- Check for network connectivity issues
- Update to latest version

## Performance Issues

### Slow Response Times

**Symptoms**: Requests take longer than expected (>5 seconds)

**Diagnostics**:
```javascript
// Check cache performance
const result = await client.callTool('diagnostic_info');
const stats = JSON.parse(result.content[0].text).diagnostics.cache_stats;
console.log('Cache Hit Rate:', stats.hit_rate); // Should be >60%
```

**Solutions**:
- Verify cache warming is enabled (v0.8.x)
- Check cache hit rate (should be 60-80% after warmup)
- Increase cache TTL for static data
- Use cache warming by setting default budget
- Check network latency to YNAB API

**Expected performance**:
- Cached requests: <1 second
- Fresh API requests: 1-5 seconds
- Large data sets: 5-10 seconds

### High Memory Usage

**Symptoms**: Memory usage grows over time, eventual crashes

**Diagnostics**:
```javascript
// Check memory usage
const result = await client.callTool('diagnostic_info');
const memory = JSON.parse(result.content[0].text).diagnostics.server_info.memory_usage;
console.log('Memory:', memory);
```

**Solutions**:
- Check cache size limits (default: 1000 entries)
- Reduce `YNAB_MCP_CACHE_MAX_ENTRIES` if needed
- Verify LRU eviction is working
- Restart server periodically for long-running instances
- Check for memory leaks (monitor over time)

**Healthy memory usage**:
- Baseline: 50-100MB
- Under load: 100-200MB
- Max acceptable: <500MB

### Cache Not Working

**Symptoms**: Every request hits YNAB API, no performance improvement

**Diagnostics**:
```javascript
// Verify cache stats
const stats = cacheManager.getStats();
console.log('Cache Stats:', {
  hitRate: stats.hit_rate,
  totalHits: stats.total_hits,
  totalMisses: stats.total_misses
});
```

**Solutions**:
- Verify cache is enabled (check environment variables)
- Ensure consistent cache keys are used
- Check TTL configuration isn't too short
- Verify cache warming triggered (use `set_default_budget`)
- Check cache isn't being cleared unintentionally

## Data Issues

### Missing Transactions

**Symptoms**: Transactions exist in YNAB but don't appear in results

**Solutions**:
- Check date filters (transactions may be outside range)
- Verify account/category filters
- Check for hidden/deleted transactions
- Clear cache and retry
- Verify budget context is correct

### Incorrect Balances

**Symptoms**: Account or category balances don't match YNAB

**Solutions**:
- Clear cache to get fresh data
- Verify all transactions are included
- Check for pending/uncleared transactions
- Ensure milliunits conversion is correct
- Verify reconciliation status

### Duplicate Transactions

**Symptoms**: Same transaction appears multiple times

**Solutions**:
- Use transaction IDs to deduplicate
- Check import detection settings
- Verify transaction matching logic
- Use the `compare_transactions` tool for CSV imports
- Review reconciliation recommendations

## Debug Techniques

### Enable Detailed Logging

```bash
# Set environment variable for debug logging
LOG_LEVEL=debug npm start

# Or in .env file
LOG_LEVEL=debug
```

### Use Diagnostic Info Tool

```javascript
// Get comprehensive server diagnostics
async function runDiagnostics() {
  const result = await client.callTool('diagnostic_info');
  const diagnostics = JSON.parse(result.content[0].text);

  console.log('Server Info:', diagnostics.diagnostics.server_info);
  console.log('Environment:', diagnostics.diagnostics.environment);
  console.log('Cache Stats:', diagnostics.diagnostics.cache_stats);
  console.log('Security Stats:', diagnostics.diagnostics.security_stats);

  return diagnostics;
}
```

### Log API Calls

```javascript
class DebugLogger {
  static logAPICall(toolName, params, result) {
    console.log(`[API] ${toolName}:`, {
      params: this.sanitizeParams(params),
      resultSize: JSON.stringify(result).length,
      timestamp: new Date().toISOString()
    });
  }

  static sanitizeParams(params) {
    // Remove sensitive data from logs
    const sanitized = { ...params };
    if (sanitized.budget_id) {
      sanitized.budget_id = sanitized.budget_id.substring(0, 8) + '...';
    }
    return sanitized;
  }

  static logError(error, context) {
    console.error(`[ERROR] ${context}:`, {
      message: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
  }
}

// Usage in your code
const result = await client.callTool('list_budgets', {});
DebugLogger.logAPICall('list_budgets', {}, result);
```

### Monitor Cache Performance

```javascript
// Periodically log cache performance
setInterval(async () => {
  const result = await client.callTool('diagnostic_info');
  const stats = JSON.parse(result.content[0].text).diagnostics.cache_stats;

  console.log('Cache Performance:', {
    hitRate: stats.hit_rate.toFixed(2),
    entries: stats.total_entries,
    hits: stats.total_hits,
    misses: stats.total_misses
  });
}, 60000); // Every minute
```

### Test Specific Scenarios

```javascript
// Create a test suite for specific issues
async function testScenario() {
  console.log('Testing budget access...');
  const budgets = await client.callTool('list_budgets', {});
  console.log('✓ Budgets retrieved');

  console.log('Testing account access...');
  const accounts = await client.callTool('list_accounts', {
    budget_id: budgets.budgets[0].id
  });
  console.log('✓ Accounts retrieved');

  console.log('Testing transaction access...');
  const transactions = await client.callTool('list_transactions', {
    budget_id: budgets.budgets[0].id
  });
  console.log('✓ Transactions retrieved');

  console.log('All tests passed!');
}
```

### Compare with YNAB Web App

When data discrepancies occur:

1. **Check same data in YNAB web app**
2. **Compare IDs, amounts, dates**
3. **Verify account/budget context matches**
4. **Check for timezone differences**
5. **Clear cache and retry**

### Check YNAB API Status

If experiencing widespread issues:

1. Visit [YNAB API Status](https://status.youneedabudget.com/)
2. Check for reported incidents
3. Verify API availability
4. Check for maintenance windows

## Getting Additional Help

If issues persist:

1. **Check Documentation**:
   - [API Reference](API.md)
   - [Development Guide](../guides/DEVELOPMENT.md)
   - [Architecture Guide](../guides/ARCHITECTURE.md)

2. **Review Logs**:
   - Claude Desktop logs
   - Server console output
   - Diagnostic info output

3. **Report Issues**:
   - GitHub Issues for bug reports
   - Include: version, error messages, steps to reproduce
   - Provide diagnostic info (sanitize sensitive data)

4. **Community Resources**:
   - YNAB API Documentation
   - MCP Protocol Documentation
   - Project GitHub Discussions

---

For development patterns and best practices, see [`../guides/DEVELOPMENT.md`](../guides/DEVELOPMENT.md).
For testing strategies, see [`../guides/TESTING.md`](../guides/TESTING.md).

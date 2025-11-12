# YNAB MCP Server - Testing Guide

Comprehensive testing guide covering automated tests, manual test scenarios, and quality assurance processes.

## Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Running Tests](#running-tests)
- [Environment Setup](#environment-setup)
- [Test Types](#test-types)
- [Coverage Requirements](#coverage-requirements)
- [Manual Test Scenarios](#manual-test-scenarios)
- [Test Data Management](#test-data-management)
- [Common Issues](#common-issues)

## Overview

The YNAB MCP Server includes both automated and manual testing capabilities:

**Automated Tests**:
1. **Unit Tests** - Test individual components in isolation
2. **Integration Tests** - Test component interactions with mocked dependencies
3. **End-to-End Tests** - Test complete workflows with real YNAB API (optional)
4. **Performance Tests** - Test response times, memory usage, and load handling

**Manual Testing**:
- Comprehensive test scenarios for Claude Desktop integration
- Feature verification workflows
- Performance and reliability validation

## Test Structure

```
src/
├── __tests__/                     # Global test utilities and E2E tests
│   ├── setup.ts                   # Test environment setup
│   ├── testUtils.ts               # Shared test utilities
│   ├── testRunner.ts              # Comprehensive test runner
│   ├── workflows.e2e.test.ts      # End-to-end workflow tests
│   ├── comprehensive.integration.test.ts  # Integration tests
│   └── performance.test.ts        # Performance and load tests
├── server/__tests__/              # Server component tests
├── tools/__tests__/               # Tool-specific tests
└── types/__tests__/               # Type definition tests
```

## Running Tests

### Quick Test Commands

```bash
# Run all tests with coverage
npm test

# Run specific test types
npm run test:unit           # Unit tests only (fast, mocked)
npm run test:integration    # Integration tests (mocked API)
npm run test:e2e           # End-to-end tests (real API)
npm run test:performance   # Performance tests

# Generate coverage report
npm run test:coverage

# Run comprehensive test suite with detailed reporting
npm run test:comprehensive

# Watch mode for test development
npm run test:watch
```

## Environment Setup

### For Unit and Integration Tests (using mocks):
```bash
# Optional - will use mock token if not provided
YNAB_ACCESS_TOKEN=your_test_token
```

### For End-to-End Tests (using real YNAB API):
```bash
# Required for E2E tests
YNAB_ACCESS_TOKEN=your_real_ynab_personal_access_token

# Optional - specify test budget/account IDs
TEST_BUDGET_ID=your_test_budget_id
TEST_ACCOUNT_ID=your_test_account_id

# Optional - skip E2E tests
SKIP_E2E_TESTS=true
```

## Test Types

### Unit Tests
- Test individual functions and classes in isolation
- Use mocked dependencies
- Fast execution (< 10 seconds)
- No external API calls

### Integration Tests
- Test component interactions
- Use mocked YNAB API responses
- Validate complete tool workflows
- Medium execution time (10-30 seconds)

### End-to-End Tests
- Test against real YNAB API
- Validate complete user workflows
- Slower execution (30-60 seconds)
- **Warning**: Creates real data in your test budget

### Performance Tests
- Test response times and memory usage
- Validate performance under load
- Test error handling performance
- Medium execution time (15-30 seconds)

## Coverage Requirements

The test suite enforces minimum coverage thresholds:

- **Lines**: 80%
- **Functions**: 80%
- **Branches**: 80%
- **Statements**: 80%

---

# Manual Test Scenarios

Comprehensive test scenarios for manually validating the YNAB MCP server with Claude Desktop.

## 1. Setup Verification Tests

### 1.1 Server Startup and Connection

**Objective**: Verify the server starts successfully and Claude Desktop connects.

**Steps**:
1. Build the project: `npm run build`
2. Configure Claude Desktop with MCP server settings
3. Restart Claude Desktop
4. Check MCP servers list in Claude Desktop

**Expected Results**:
- Build completes without errors
- Claude Desktop shows "ynab-mcp-server" in connected servers
- No connection errors in Claude Desktop logs

**Success Criteria**: Server appears as connected in Claude Desktop interface

### 1.2 YNAB Token Authentication

**Objective**: Verify YNAB Personal Access Token is valid and working.

**Steps**:
1. Ask Claude: "Can you run the diagnostic_info tool?"
2. Check the returned authentication status
3. Verify user information is retrieved

**Expected Results**:
- Diagnostic info returns successfully
- Authentication status shows "authenticated: true"
- User information includes YNAB user details

**Success Criteria**: No authentication errors, user data present

### 1.3 System Status Verification

**Objective**: Verify all server components are initialized properly.

**Steps**:
1. Run diagnostic_info tool
2. Review system configuration
3. Check cache initialization
4. Verify environment variables

**Expected Results**:
- All services report healthy status
- Cache is initialized with correct settings
- Environment variables loaded properly
- Tool registry shows all tools

**Success Criteria**: All system components report healthy status

## 2. Basic Functionality Tests

### 2.1 Budget Management

**Objective**: Test basic budget listing and selection functionality.

**Steps**:
1. Ask Claude: "List my YNAB budgets"
2. Note the budget names returned
3. Ask Claude: "Set my default budget to [budget_name]"
4. Ask Claude: "What is my current default budget?"

**Expected Results**:
- Budget list returns user's budgets with names and IDs
- Default budget is set successfully
- Cache warming is triggered automatically
- Default budget query returns the selected budget

**Success Criteria**: Budget operations work without errors, cache warming occurs

### 2.2 Account Listing

**Objective**: Test account retrieval and caching behavior.

**Steps**:
1. Ask Claude: "List my accounts" (first time)
2. Note response time
3. Ask Claude: "List my accounts" (second time)
4. Compare response times
5. Check diagnostic_info for cache hits

**Expected Results**:
- First request fetches from YNAB API
- Second request is faster (cache hit)
- Both requests return identical account data
- Cache metrics show hit count increase

**Success Criteria**: Caching improves response time, data consistency maintained

### 2.3 Transaction Retrieval

**Objective**: Test transaction listing with various filters.

**Steps**:
1. Ask Claude: "Show me recent transactions"
2. Ask Claude: "Show me transactions from a specific account"
3. Ask Claude: "Show me transactions from the last 30 days"
4. Ask Claude: "Show me uncategorized transactions"

**Expected Results**:
- All transaction queries return appropriate data
- Filters work correctly (account, date range, categorization status)
- Response times are reasonable
- Data format is consistent

**Success Criteria**: All transaction filters work correctly, consistent formatting

## 3. Enhanced Caching Tests

### 3.1 Cache Warming Verification

**Objective**: Verify cache warming works after setting default budget.

**Steps**:
1. Clear cache (restart server or use diagnostic tools)
2. Set default budget
3. Check cache metrics immediately after
4. Verify accounts, categories, and payees are cached

**Expected Results**:
- Cache warming triggers automatically
- Accounts, categories, and payees are pre-loaded
- Subsequent requests for these data types are fast
- Cache hit rate improves dramatically

**Success Criteria**: Cache warming pre-loads commonly used data

### 3.2 LRU Eviction Testing

**Objective**: Test cache eviction when limits are reached.

**Steps**:
1. Set cache limit to low value (via environment variables)
2. Request data for multiple different filters
3. Check cache metrics for evictions
4. Verify least recently used items are evicted first

**Expected Results**:
- Cache respects maximum entry limits
- Older entries are evicted as new ones are added
- Most frequently accessed data remains cached
- No memory leaks occur

**Success Criteria**: LRU eviction maintains cache within limits

### 3.3 Stale-While-Revalidate Testing

**Objective**: Test stale data serving while refreshing in background.

**Steps**:
1. Cache some data and wait for it to become stale
2. Request the stale data
3. Verify immediate response with stale data
4. Confirm background refresh occurs

**Expected Results**:
- Stale data is served immediately for fast response
- Background refresh updates the cache
- User gets immediate response, cache stays fresh
- No blocking on refresh operations

**Success Criteria**: Stale-while-revalidate provides fast responses while maintaining freshness

## 4. Tool Registry Tests

### 4.1 All Tools Accessibility

**Objective**: Verify all tools are accessible through Claude Desktop.

**Steps**:
1. Ask Claude to list available YNAB tools
2. Test a selection of tools from different categories:
   - Budget management (list_budgets, set_default_budget)
   - Account management (list_accounts, get_account)
   - Transaction management (list_transactions, create_transaction)
   - Monthly data analysis (get_month, list_months)
   - Utility tools (diagnostic_info, convert_amount)

**Expected Results**:
- All tools are accessible and respond correctly
- Parameter validation works consistently
- Error handling is uniform across tools
- Tool descriptions are helpful and accurate

**Success Criteria**: All tools accessible with consistent behavior

### 4.2 Parameter Validation

**Objective**: Test parameter validation across different tools.

**Steps**:
1. Try tools with missing required parameters
2. Try tools with invalid parameter values
3. Try tools with correct parameters
4. Test optional parameter handling

**Expected Results**:
- Missing required parameters result in clear error messages
- Invalid parameters are rejected with helpful guidance
- Valid parameters are processed correctly
- Optional parameters work when provided or omitted

**Success Criteria**: Consistent parameter validation with helpful error messages

## 5. Transaction Management Tests

### 5.1 Transaction Creation

**Objective**: Test creating new transactions.

**Steps**:
1. Ask Claude: "Create a test transaction for $10.00 groceries"
2. Verify transaction appears in YNAB
3. Check transaction details
4. Clean up test transaction

**Expected Results**:
- Transaction is created successfully
- All details are recorded correctly
- Transaction appears in YNAB interface
- Appropriate account and category are used

**Success Criteria**: Transaction creation works with accurate data

### 5.2 Transaction Export

**Objective**: Test transaction export functionality.

**Steps**:
1. Ask Claude: "Export my transactions to a file"
2. Check export directory for file
3. Review exported data format
4. Verify data completeness

**Expected Results**:
- Export file is created in correct directory
- File contains accurate transaction data
- Format is readable and well-structured
- All requested transactions are included

**Success Criteria**: Export creates complete, accurate files

### 5.3 CSV Comparison

**Objective**: Test CSV comparison functionality.

**Steps**:
1. Use a sample CSV file
2. Ask Claude: "Compare this CSV with my YNAB transactions"
3. Review matching results
4. Check unmatched transaction identification

**Expected Results**:
- CSV parsing works correctly
- Transaction matching algorithms function properly
- Unmatched transactions are identified
- Clear reporting of comparison results

**Success Criteria**: CSV comparison accurately identifies matches and discrepancies

### 5.4 Account Reconciliation

**Objective**: Test comprehensive account reconciliation.

**Steps**:
1. Prepare CSV export from your bank
2. Ask Claude: "Reconcile my checking account with this CSV"
3. Review matching analysis
4. Check balance verification
5. Review recommendations

**Expected Results**:
- Smart duplicate matching works correctly
- Automatic date adjustment handles timezone issues
- Balance matching provides exact reconciliation
- Comprehensive reporting shows all details

**Success Criteria**: Reconciliation accurately matches transactions and balances

## 6. Error Handling Tests

### 6.1 Missing Budget ID Scenarios

**Objective**: Test behavior when no default budget is set.

**Steps**:
1. Clear default budget setting
2. Try tools that require budget context
3. Check error messages
4. Verify recovery guidance

**Expected Results**:
- Clear error messages about missing budget
- Helpful guidance on setting default budget
- No system crashes or unclear errors
- Easy recovery path provided

**Success Criteria**: Clear error messages with actionable recovery steps

### 6.2 Invalid Parameter Testing

**Objective**: Test handling of invalid parameters.

**Steps**:
1. Try tools with malformed parameters
2. Test with out-of-range values
3. Try with incorrect data types
4. Test with missing required fields

**Expected Results**:
- Validation catches all invalid parameters
- Error messages clearly identify the problem
- Suggestions for correct parameter format
- No system instability from bad inputs

**Success Criteria**: Robust parameter validation with helpful error messages

### 6.3 YNAB API Error Scenarios

**Objective**: Test handling of YNAB API errors.

**Steps**:
1. Test with expired token (if possible)
2. Test during YNAB API maintenance
3. Test with network connectivity issues
4. Test with rate limiting scenarios

**Expected Results**:
- Graceful handling of API errors
- Clear error messages about external issues
- No server crashes or hangs
- Appropriate retry mechanisms

**Success Criteria**: Robust error handling for external API issues

## 7. Performance Tests

### 7.1 Response Time Verification

**Objective**: Verify acceptable response times with and without caching.

**Steps**:
1. Measure response times for fresh requests
2. Measure response times for cached requests
3. Compare performance improvements
4. Test with large data sets

**Expected Results**:
- Fresh requests complete within reasonable time (< 5 seconds)
- Cached requests are significantly faster (< 1 second)
- Large data sets are handled efficiently
- No performance degradation over time

**Success Criteria**: Response times meet performance expectations

### 7.2 Concurrent Request Handling

**Objective**: Test server behavior under concurrent load.

**Steps**:
1. Make multiple simultaneous requests
2. Check for race conditions
3. Verify data consistency
4. Monitor resource usage

**Expected Results**:
- Concurrent requests handled properly
- No race conditions in cache or data
- Consistent results across all requests
- Reasonable resource usage

**Success Criteria**: Stable performance under concurrent load

### 7.3 Memory Usage Monitoring

**Objective**: Verify memory usage remains stable during extended use.

**Steps**:
1. Monitor baseline memory usage
2. Perform extended testing session
3. Check for memory leaks
4. Verify cache size limits are respected

**Expected Results**:
- Memory usage remains stable over time
- No significant memory leaks detected
- Cache eviction prevents unbounded growth
- Resource usage stays within acceptable limits

**Success Criteria**: Stable memory usage without leaks

## Test Data Management

### Mock Data
- Unit and integration tests use mock data
- Mock responses are defined in test files
- No real API calls or data modification

### E2E Test Data
- E2E tests create real data in your YNAB budget
- Test transactions are automatically cleaned up
- Test accounts cannot be deleted via API (manual cleanup required)
- Use a dedicated test budget to avoid affecting real data

## Common Issues and Solutions

### E2E Tests Skipped
```
⏭️ E2E tests skipped (no API key or SKIP_E2E_TESTS=true)
```
**Solution**: Set `YNAB_ACCESS_TOKEN` environment variable

### Coverage Below Threshold
```
⚠️ Coverage below target (<80%)
```
**Solution**: Add more tests or remove untestable code from coverage

### Performance Tests Failing
```
❌ Performance assertion failed: 1500ms > 1000ms
```
**Solution**: Optimize code or adjust performance thresholds

### Connection Errors in Claude Desktop
**Solution**:
1. Verify Node.js version (18+)
2. Check build completed successfully
3. Verify MCP server configuration
4. Restart Claude Desktop completely

## Test Execution Guidelines

1. **Prerequisites**: Ensure .env file is configured with valid YNAB token
2. **Environment**: Use development configuration for detailed logging
3. **Documentation**: Record results for each test scenario
4. **Issues**: Log any problems with steps to reproduce
5. **Performance**: Record timing measurements for performance tests
6. **Cleanup**: Clean up test data after testing (transactions, exports)

## Success Criteria Summary

- ✅ All basic functionality works correctly
- ✅ Enhanced caching provides performance improvements
- ✅ Error handling is robust and helpful
- ✅ All tools are accessible and functional
- ✅ Transaction management works reliably
- ✅ Performance meets or exceeds expectations
- ✅ Integration with Claude Desktop is seamless
- ✅ Security and reliability standards are met

---

For automated testing implementation details, see the source code in `src/__tests__/`.
For additional testing checklists, see `../development/TESTING_CHECKLIST.md`.

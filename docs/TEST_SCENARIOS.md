# YNAB MCP Server Test Scenarios

This document provides comprehensive test scenarios for manually testing the YNAB MCP server with Claude Desktop. Each scenario includes expected results, success criteria, and troubleshooting steps.

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
- Tool registry shows all 27 tools

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

1. Set cache limit to low value (already set to 100 in .env)
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

1. Cache some data and wait for it to become stale (30 seconds with current settings)
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

**Objective**: Verify all 27 tools are accessible through Claude Desktop.

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

### 4.3 Security Middleware Integration

**Objective**: Verify security middleware applies consistently.

**Steps**:

1. Test tools with various input types
2. Verify input sanitization occurs
3. Check for consistent security headers
4. Test error response sanitization

**Expected Results**:

- All inputs are properly sanitized
- Security middleware applies to all tools
- No sensitive information leaks in error messages
- Consistent security posture across all endpoints

**Success Criteria**: Security middleware functions consistently across all tools

## 5. Financial Analysis Tests

### 5.1 Financial Overview

**Objective**: Test comprehensive financial analysis functionality.

**Steps**:

1. Ask Claude: "Give me a financial overview for the last 3 months"
2. Review trends analysis
3. Check insights generation
4. Verify data accuracy against YNAB

**Expected Results**:

- Comprehensive financial summary with trends
- Actionable insights about spending patterns
- Accurate calculations based on YNAB data
- Clear, readable formatting

**Success Criteria**: Financial overview provides valuable insights with accurate data

### 5.2 Spending Analysis

**Objective**: Test detailed spending analysis with category breakdowns.

**Steps**:

1. Ask Claude: "Analyze my spending for the last 6 months"
2. Request category-specific analysis
3. Review trend calculations
4. Check for outlier detection

**Expected Results**:

- Detailed spending breakdown by category
- Trend analysis showing changes over time
- Identification of unusual spending patterns
- Actionable recommendations for improvement

**Success Criteria**: Spending analysis provides detailed, actionable insights

### 5.3 Budget Health Check

**Objective**: Test budget health assessment functionality.

**Steps**:

1. Ask Claude: "Perform a budget health check"
2. Review health scores
3. Check recommendations
4. Verify accuracy of assessments

**Expected Results**:

- Overall budget health score
- Category-specific health assessments
- Actionable recommendations for improvement
- Clear explanation of scoring methodology

**Success Criteria**: Health check provides accurate assessment with helpful recommendations

## 6. Transaction Management Tests

### 6.1 Transaction Creation

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

### 6.2 Transaction Export

**Objective**: Test transaction export functionality.

**Steps**:

1. Ask Claude: "Export my transactions to a file"
2. Check test-exports directory for file
3. Review exported data format
4. Verify data completeness

**Expected Results**:

- Export file is created in test-exports directory
- File contains accurate transaction data
- Format is readable and well-structured
- All requested transactions are included

**Success Criteria**: Export creates complete, accurate files

### 6.3 Transaction Comparison

**Objective**: Test CSV comparison functionality with sample data.

**Steps**:

1. Use test-csv-sample.csv file
2. Ask Claude: "Compare this CSV with my YNAB transactions"
3. Review matching results
4. Check unmatched transaction identification

**Expected Results**:

- CSV parsing works correctly
- Transaction matching algorithms function properly
- Unmatched transactions are identified
- Clear reporting of comparison results

**Success Criteria**: CSV comparison accurately identifies matches and discrepancies

## 7. Error Handling Tests

### 7.1 Missing Budget ID Scenarios

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

### 7.2 Invalid Parameter Testing

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

### 7.3 YNAB API Error Scenarios

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

## 8. Performance Tests

### 8.1 Response Time Verification

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

### 8.2 Concurrent Request Handling

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

### 8.3 Memory Usage Monitoring

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

## 9. Integration Tests

### 9.1 Resource Access Testing

**Objective**: Test MCP resource functionality.

**Steps**:

1. Ask Claude about available YNAB resources
2. Test resource access (ynab://budgets, ynab://user)
3. Verify resource content
4. Test resource caching

**Expected Results**:

- Resources are accessible through Claude
- Content is accurate and up-to-date
- Resource caching works properly
- Clear resource descriptions

**Success Criteria**: MCP resources provide accurate, accessible data

### 9.2 Prompt Functionality Testing

**Objective**: Test MCP prompt functionality.

**Steps**:

1. Test available prompts
2. Verify prompt parameter handling
3. Check prompt execution
4. Test prompt caching

**Expected Results**:

- Prompts execute correctly
- Parameters are handled properly
- Results are accurate and useful
- Prompt caching improves performance

**Success Criteria**: MCP prompts function correctly with good performance

## 10. Regression Tests

### 10.1 Backward Compatibility

**Objective**: Verify v0.8.0 maintains compatibility with v0.7.x functionality.

**Steps**:

1. Test all tools that existed in v0.7.x
2. Verify response formats match previous versions
3. Check parameter compatibility
4. Test error response formats

**Expected Results**:

- All v0.7.x functionality works identically
- Response formats are unchanged
- No breaking changes in tool parameters
- Error responses maintain consistency

**Success Criteria**: Full backward compatibility with previous version

### 10.2 Performance Regression Testing

**Objective**: Verify v0.8.0 performance meets or exceeds v0.7.x.

**Steps**:

1. Compare response times between versions
2. Check memory usage differences
3. Verify cache improvements provide benefits
4. Test with equivalent workloads

**Expected Results**:

- Response times are same or better than v0.7.x
- Memory usage is controlled and efficient
- Cache improvements provide measurable benefits
- Overall performance is improved

**Success Criteria**: Performance meets or exceeds previous version

## Test Execution Guidelines

1. **Prerequisites**: Ensure .env file is configured with valid YNAB token
2. **Environment**: Use the development configuration for detailed logging
3. **Documentation**: Record results for each test scenario
4. **Issues**: Log any problems with steps to reproduce
5. **Performance**: Record timing measurements for performance tests
6. **Cleanup**: Clean up test data after testing (transactions, exports)

## Success Criteria Summary

- ✅ All basic functionality works correctly
- ✅ Enhanced caching provides performance improvements
- ✅ Error handling is robust and helpful
- ✅ All 27 tools are accessible and functional
- ✅ Financial analysis provides valuable insights
- ✅ Transaction management works reliably
- ✅ Performance meets or exceeds expectations
- ✅ Integration with Claude Desktop is seamless
- ✅ Backward compatibility is maintained
- ✅ Security and reliability standards are met

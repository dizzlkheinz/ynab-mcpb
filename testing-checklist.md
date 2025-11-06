# YNAB MCP Server Testing Checklist

A comprehensive testing checklist for validating the YNAB MCP server with Claude Desktop integration.

## Pre-Testing Setup

- [ ] **YNAB Personal Access Token** obtained from https://app.youneedabudget.com/settings/developer
- [ ] **YNAB Token configured** in .env file (YNAB_ACCESS_TOKEN set)
- [ ] **Node.js 18+** installed and verified (`node --version`)
- [ ] **Project dependencies** installed (`npm install` completed successfully)
- [ ] **Environment file** (.env) created with development settings
- [ ] **Test export directory** (test-exports) created
- [ ] **Claude Desktop** installed and updated to latest version

## Build and Development Testing

- [ ] **TypeScript compilation** successful (`npm run build` completes without errors)
- [ ] **All tests pass** (`npm test` runs successfully)
- [ ] **Development server** starts without errors (`npm run dev`)
- [ ] **Production build** completes (`npm run build:prod`)
- [ ] **DXT package generation** works (`npm run package:dxt` creates .dxt file)
- [ ] **Built files** exist in dist/ directory

## Claude Desktop Integration

- [ ] **Local MCP server configuration** added to Claude Desktop settings
- [ ] **Claude Desktop connects** to server successfully (no connection errors)
- [ ] **Server appears** in Claude Desktop's MCP servers list as "connected"
- [ ] **No connection errors** in Claude Desktop logs or error messages
- [ ] **Restart Claude Desktop** and verify connection persists

## Basic Functionality Verification

- [ ] **diagnostic_info tool** returns system information without errors
- [ ] **list_budgets** returns user's budgets with correct names and IDs
- [ ] **set_default_budget** works and triggers cache warming
- [ ] **get_default_budget** returns the currently set default budget
- [ ] **list_accounts** returns account information for default budget
- [ ] **list_transactions** returns transaction data without errors

## Enhanced Caching Verification

- [ ] **Cache warming** occurs automatically after `set_default_budget`
- [ ] **Repeated calls** show improved response times (second call faster)
- [ ] **Cache hit/miss metrics** are tracked correctly in diagnostic_info
- [ ] **LRU eviction** works when cache limit (100 entries) is reached
- [ ] **Stale-while-revalidate** serves stale data while refreshing background
- [ ] **Cache metrics** visible and accurate in `diagnostic_info` output

## Tool Registry Verification

- [ ] **All 27 tools** are accessible through Claude Desktop interface
- [ ] **Parameter validation** works consistently across all tools
- [ ] **Error messages** are clear and actionable for invalid parameters
- [ ] **Security middleware** applies to all tools consistently
- [ ] **Budget resolution** works consistently across tools requiring budget context

## Modular Architecture Verification

- [ ] **ResourceManager** provides MCP resources correctly (ynab://budgets, ynab://user)
- [ ] **PromptManager** provides MCP prompts correctly
- [ ] **DiagnosticManager** collects comprehensive system diagnostics
- [ ] **Config module** validates environment variables correctly
- [ ] **All service modules** integrate properly without conflicts

## Financial Analysis Tools

- [ ] **financial_overview** provides comprehensive analysis with trends and insights
- [ ] **spending_analysis** shows detailed category breakdowns and trends
- [ ] **budget_health_check** provides health scores and actionable recommendations
- [ ] **Trend analysis** works correctly with historical data
- [ ] **Insights generation** provides actionable and relevant recommendations

## Transaction Management

- [ ] **create_transaction** creates transactions successfully in YNAB
- [ ] **create_receipt_split_transaction** builds multi-line splits with proportional tax allocation
- [ ] **update_transaction** modifies existing transactions correctly
- [ ] **delete_transaction** removes transactions from YNAB
- [ ] **export_transactions** creates files in test-exports directory
- [ ] **compare_transactions** works correctly with test-csv-sample.csv
- [ ] **reconcile_account** provides comprehensive reconciliation analysis

## Error Handling and Edge Cases

- [ ] **Missing budget ID** shows helpful error message with recovery guidance
- [ ] **Invalid parameters** are rejected with clear, actionable error messages
- [ ] **YNAB API errors** are handled gracefully without server crashes
- [ ] **Network errors** don't crash the server or cause hangs
- [ ] **Large data sets** are handled efficiently without timeouts

## Performance and Reliability

- [ ] **Response times** are acceptable (< 2 seconds for cached data, < 5 seconds fresh)
- [ ] **Memory usage** remains stable during extended use sessions
- [ ] **No memory leaks** detected over extended testing period
- [ ] **Concurrent requests** handled properly without race conditions
- [ ] **Cache eviction** prevents unbounded memory growth

## Backward Compatibility

- [ ] **All v0.7.x functionality** works identically to previous version
- [ ] **Response formats** match previous versions exactly
- [ ] **No breaking changes** in tool parameters or behavior
- [ ] **Error response formats** are consistent with v0.7.x

## Documentation and User Experience

- [ ] **Tool descriptions** are clear and helpful in Claude Desktop
- [ ] **Parameter descriptions** guide proper usage effectively
- [ ] **Error messages** provide actionable guidance for resolution
- [ ] **Cache behavior** is transparent to users (faster responses)
- [ ] **Performance improvements** are noticeable and beneficial

## Specific Test Scenarios

### Budget Management

- [ ] List budgets works with multiple budgets
- [ ] Set default budget triggers cache warming
- [ ] Default budget persists across server restarts
- [ ] Budget resolution works across all tools

### Account Operations

- [ ] List accounts shows all account types correctly
- [ ] Get specific account details works
- [ ] Account balance information is accurate
- [ ] Account caching improves performance

### Transaction Operations

- [ ] List transactions with date filters
- [ ] List transactions with account filters
- [ ] List transactions with category filters
- [ ] Create test transaction (remember to clean up)
- [ ] Update transaction details
- [ ] Delete test transaction

### CSV Comparison Testing

- [ ] CSV parsing works with test-csv-sample.csv
- [ ] Transaction matching algorithms function correctly
- [ ] Unmatched transactions are identified properly
- [ ] Date tolerance matching works (±5 days)
- [ ] Amount tolerance matching works (±$0.01)

### Export Functionality

- [ ] Export creates files in test-exports directory
- [ ] Export file format is correct and readable
- [ ] Export includes all requested transaction data
- [ ] Export handles large transaction sets

### Cache Testing

- [ ] Cache warming pre-loads accounts, categories, payees
- [ ] Cache hit rates improve with repeated requests
- [ ] Cache eviction works with 100-entry limit
- [ ] Stale-while-revalidate improves user experience

## Final Validation

- [ ] **Complete workflow tests** pass (budget → accounts → transactions → analysis)
- [ ] **All test scenarios** from test-scenarios.md completed successfully
- [ ] **No critical issues** identified during testing
- [ ] **Performance meets** or exceeds v0.7.x benchmarks
- [ ] **Ready for production** use with real YNAB data

## Security Verification

- [ ] **Input sanitization** works across all tools
- [ ] **No sensitive data** exposed in error messages
- [ ] **YNAB token** handled securely (not logged or exposed)
- [ ] **Error responses** don't leak internal information
- [ ] **Security middleware** prevents common attacks

## Resource Testing

- [ ] **ynab://budgets** resource provides budget information
- [ ] **ynab://user** resource provides user information
- [ ] **Resource caching** improves performance
- [ ] **Resource updates** reflect current YNAB state

## Prompt Testing

- [ ] **Available prompts** execute correctly
- [ ] **Prompt parameters** are handled properly
- [ ] **Prompt results** are accurate and useful
- [ ] **Prompt caching** improves performance

## Post-Testing Validation

- [ ] **Test results** documented and reviewed
- [ ] **Performance metrics** recorded and analyzed
- [ ] **Any issues** logged with reproduction steps
- [ ] **User feedback** collected and noted
- [ ] **Next steps** identified for any remaining work

## Test Environment Cleanup

- [ ] **Test transactions** removed from YNAB
- [ ] **Test export files** cleaned up from test-exports directory
- [ ] **Cache cleared** if needed for fresh testing
- [ ] **Environment reset** to clean state

## Success Criteria Summary

The YNAB MCP server testing is considered successful when:

✅ **All basic functionality** works without errors
✅ **Enhanced caching** provides measurable performance improvements
✅ **Error handling** is robust with helpful user guidance
✅ **All 27 tools** are accessible and functional
✅ **Financial analysis** provides valuable, accurate insights
✅ **Transaction management** works reliably with YNAB
✅ **Performance** meets or exceeds v0.7.x baseline
✅ **Claude Desktop integration** is seamless and stable
✅ **Backward compatibility** is maintained completely
✅ **Security and reliability** standards are met

## Notes Section

Use this space to record:

- Performance measurements
- Issues encountered and resolutions
- User experience observations
- Recommendations for improvements
- Testing environment details

---

**Testing Date**: **\*\***\_\_\_\_**\*\***
**Tester**: **\*\***\_\_\_\_**\*\***
**Claude Desktop Version**: **\*\***\_\_\_\_**\*\***
**Server Version**: v0.8.2
**Overall Result**: [ ] PASS [ ] FAIL [ ] NEEDS REVIEW

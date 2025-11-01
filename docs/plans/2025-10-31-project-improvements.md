# YNAB MCP Server - Project Improvements Roadmap

**Date**: 2025-10-31
**Status**: Planning Phase
**Context**: Post-reconciliation redesign, identifying high-impact improvements

## Overview

This document outlines improvement opportunities for the YNAB MCP Server beyond the reconciliation tool redesign. Prioritized based on user impact, technical feasibility, and alignment with project goals.

## High Priority Improvements

### 1. Performance Instrumentation & Optimization

**Problem**: Beyond caching, we lack visibility into where time is spent during tool execution.

**Solution**: Comprehensive performance monitoring
- Instrument all tools to track API latency
- Add performance metrics to diagnostic output
- Identify slow operations for optimization
- Track cache hit/miss rates per tool

**Implementation**:
```typescript
// Add to tool registry wrapper
async function instrumentedToolExecution(tool: string, handler: Function) {
  const start = performance.now();
  const result = await handler();
  const duration = performance.now() - start;

  performanceMetrics.record({
    tool,
    duration,
    cache_hit: result.from_cache || false,
    api_calls: result.api_call_count || 0
  });

  return result;
}
```

**Benefits**:
- Identify bottlenecks in real-world usage
- Data-driven optimization decisions
- Proactive performance regression detection

**Estimated Effort**: 1-2 weeks
**Impact**: High - enables all future performance work

---

### 2. Developer Experience CLI: `ynab-mcp doctor`

**Problem**: Debugging config issues, cache problems, and permission errors is painful.

**Solution**: Diagnostic CLI tool for developers and power users
- Lint configuration for common issues
- Check YNAB API connectivity and token validity
- Validate cache health and performance
- Inspect permission scopes
- Test MCP server connectivity

**Features**:
```bash
ynab-mcp doctor

✓ Configuration loaded successfully
✓ YNAB API token valid (expires: 2026-01-15)
✓ Cache healthy (75% hit rate, 234 entries)
⚠ Warning: Budget 'Test Budget' has not been accessed in 30 days
✗ Error: Account 'Checking' not found in default budget

  Suggestions:
  - Run `ynab-mcp doctor --fix-cache` to rebuild cache
  - Verify budget ID with `ynab-mcp list-budgets`
```

**Additional Commands**:
- `ynab-mcp doctor --fix-cache` - Rebuild cache
- `ynab-mcp doctor --test-connection` - Test YNAB API
- `ynab-mcp doctor --validate-config` - Deep config validation
- `ynab-mcp doctor --profile` - Performance profiling

**Benefits**:
- Faster debugging for developers
- Self-service troubleshooting for users
- Reduces support burden
- Better onboarding experience

**Estimated Effort**: 2-3 weeks
**Impact**: High - significantly improves DX

---

### 3. Request Coalescing / Batch Operations

**Problem**: Multiple simultaneous tool calls make redundant API requests.

**Solution**: Coalesce identical requests within time window
- Deduplicate concurrent requests for same resource
- Batch-fetch where YNAB API allows
- Request queue with intelligent batching

**Example**:
```typescript
// Before: 3 separate API calls
await Promise.all([
  getAccount(budgetId, 'acc1'),
  getAccount(budgetId, 'acc2'),
  getAccount(budgetId, 'acc3')
]);

// After: 1 batched API call
await batchGetAccounts(budgetId, ['acc1', 'acc2', 'acc3']);
```

**Benefits**:
- Reduced API calls = faster responses
- Stay within YNAB rate limits
- Better user experience

**Estimated Effort**: 2-3 weeks
**Impact**: Medium-High - noticeable speedup for bulk operations

---

### 4. Rule-Based Transaction Automation

**Problem**: Users repeatedly categorize the same payees manually.

**Solution**: Auto-categorization rules
- Define rules: "If payee contains 'SHELL', categorize as 'Gas'"
- Support memo-based rules
- Support amount-based rules
- User-manageable rule sets

**Rule Schema**:
```typescript
interface AutoCategorizeRule {
  name: string;
  conditions: {
    payee_contains?: string;
    payee_exact?: string;
    memo_contains?: string;
    amount_equals?: number;
    amount_range?: { min: number; max: number };
  };
  actions: {
    category_id?: string;
    payee_name?: string;
    memo?: string;
    flag_color?: string;
  };
  priority: number;
}
```

**Implementation Approach**:
- Rules stored in MCP server config or YNAB memo field
- Apply rules in `create_transaction` tool
- Apply rules during reconciliation import
- Rule management tools: add, edit, delete, list, test

**Benefits**:
- Massive time savings for repetitive categorization
- Consistency in transaction categorization
- Reduced manual data entry

**Estimated Effort**: 3-4 weeks
**Impact**: High - high user demand feature

---

### 5. Reconciliation Health Metrics

**Problem**: Users don't know their accounts are drifting until reconciliation fails.

**Solution**: Proactive health monitoring per account
- Track "days since last reconciliation"
- Monitor cleared vs. uncleared transaction ratios
- Detect unusual patterns (sudden spikes in uncleared)
- Alert when account needs reconciliation

**Metrics**:
```typescript
interface AccountHealthMetrics {
  account_id: string;
  last_reconciliation_date: string;
  days_since_reconciliation: number;
  cleared_balance: number;
  uncleared_balance: number;
  uncleared_transaction_count: number;
  oldest_uncleared_transaction_days: number;
  health_score: number; // 0-100
  recommendations: string[];
}
```

**Health Scores**:
- 90-100: Excellent (reconciled recently, few uncleared)
- 70-89: Good (some uncleared, but recent reconciliation)
- 50-69: Needs attention (many uncleared or old reconciliation)
- 0-49: Critical (very old reconciliation or excessive uncleared)

**Benefits**:
- Proactive problem detection
- Encourages regular reconciliation habits
- Prevents small issues from becoming big problems

**Estimated Effort**: 1-2 weeks
**Impact**: Medium - enhances reconciliation workflow

---

### 6. VS Code Snippets & Tool Development Boilerplate

**Problem**: Creating new tools requires boilerplate code across multiple files.

**Solution**: Code generation and snippets
- VS Code snippet library for tool creation
- Tool generator CLI: `ynab-mcp generate-tool <name>`
- Typed client stubs for tool handlers
- Template files for common patterns

**Generated Files**:
```bash
ynab-mcp generate-tool my_awesome_tool

Created:
  src/tools/myAwesomeTool.ts
  src/tools/__tests__/myAwesomeTool.test.ts
  src/tools/__tests__/myAwesomeTool.integration.test.ts

Next steps:
  1. Implement handler in src/tools/myAwesomeTool.ts
  2. Register tool in src/server/YNABMCPServer.ts
  3. Add tests
  4. Update docs/API.md
```

**Template includes**:
- Zod schema boilerplate
- Handler function structure
- Tool Registry registration
- Test file scaffolding
- Integration test template
- Documentation template

**Benefits**:
- Faster tool development
- Consistent code structure
- Fewer bugs from forgetting steps
- Better onboarding for contributors

**Estimated Effort**: 1-2 weeks
**Impact**: Medium - improves contributor experience

---

## Medium Priority Improvements

### 7. Recorded YNAB Fixture Test Suite

**Problem**: Integration tests require real YNAB API access, making CI/CD brittle.

**Solution**: Record real YNAB responses as fixtures
- Sanitized real YNAB data for testing
- Replay mode for integration tests
- Covers edge cases: scheduled transactions, foreign currency, splits
- Continuous contract validation

**Implementation**:
- Use VCR-like approach for HTTP recording
- Sanitize sensitive data (budget names, real amounts)
- Store fixtures in `src/__tests__/fixtures/`
- Toggle between live API and fixtures via env var

**Benefits**:
- Reliable CI/CD without real API
- Faster test execution
- Test edge cases hard to reproduce
- Regression detection for API changes

**Estimated Effort**: 2-3 weeks
**Impact**: Medium - better test reliability

---

### 8. Mutation Testing for Core Math

**Problem**: Tests might pass even with bugs in amount calculations.

**Solution**: Mutation testing on critical math utilities
- Test that amount conversions are actually tested
- Verify rounding logic is validated
- Ensure tolerance comparisons are correct

**Tools**: Stryker Mutator for TypeScript

**Target Files**:
- `src/utils/money.ts`
- `src/utils/amountUtils.ts`
- `src/tools/compareTransactions/matcher.ts` (amount tolerance)

**Benefits**:
- Catch edge cases in critical math
- Ensure tests actually validate logic
- Prevent calculation bugs

**Estimated Effort**: 1 week
**Impact**: Medium - prevents critical bugs

---

### 9. Tool Catalog Documentation

**Problem**: Users don't know what tools exist or how to use them conversationally.

**Solution**: Comprehensive tool catalog table
- List all 27 tools
- Example prompts for each
- Required credentials/permissions
- Cache behavior
- Related tools

**Example Entry**:
```markdown
| Tool | Description | Example Prompt | Cache TTL | Related |
|------|-------------|----------------|-----------|---------|
| `list_accounts` | List all accounts in budget | "Show me my checking accounts" | 30 min | `get_account`, `create_account` |
| `reconcile_account` | Reconcile account with bank statement | "Reconcile my TD Visa with this CSV" | None | `compare_transactions` |
```

**Additions**:
- Common workflows (multi-tool sequences)
- Troubleshooting section per tool
- Performance characteristics
- When to use each tool

**Benefits**:
- Better user discoverability
- Clearer expectations
- Reduces support questions
- Helps Claude suggest appropriate tools

**Estimated Effort**: 1 week (documentation)
**Impact**: Medium - improves usability

---

### 10. Architecture Decision Records (ADRs)

**Problem**: Contributors don't understand why certain design decisions were made.

**Solution**: Document key architecture decisions
- Why Tool Registry over direct switch statements?
- Why enhanced caching with stale-while-revalidate?
- Why modular architecture in v0.8.x?
- Why dependency injection pattern?

**ADR Template**:
```markdown
# ADR-001: Tool Registry Pattern

## Status
Accepted

## Context
Previous switch-based tool handling caused inconsistent validation and error handling.

## Decision
Centralized Tool Registry with metadata-driven validation.

## Consequences
**Positive:**
- Consistent validation across all tools
- Easier to add new tools
- Better error messages

**Negative:**
- Additional abstraction layer
- Slightly more complex tool registration
```

**Topics for ADRs**:
1. Tool Registry vs. Switch Statements
2. Enhanced Caching Architecture
3. Modular v0.8.x Design
4. Dependency Injection Pattern
5. Budget Resolution Strategy
6. Response Formatting (Minified by default)

**Benefits**:
- Faster onboarding for contributors
- Preserves institutional knowledge
- Prevents regression to old patterns
- Supports architectural evolution

**Estimated Effort**: 1-2 weeks
**Impact**: Low-Medium - long-term maintainability

---

## Lower Priority / Future Considerations

### 11. Scheduled Jobs & Routine Exports

**Problem**: Users want automatic daily/weekly exports for external processing.

**Solution**: Scheduled job system
- Define schedules: daily, weekly, monthly
- Jobs: export transactions, backup data, generate reports
- Configurable via environment variables

**Not prioritizing now because**:
- MCP servers are typically on-demand, not long-running
- Would require significant architecture changes
- Can be handled by external cron jobs

---

### 12. Multi-Budget Transaction Transfer

**Problem**: Moving transactions between budgets is manual.

**Solution**: Tool to copy/move transactions across budgets

**Not prioritizing now because**:
- Edge case use case
- YNAB doesn't officially support this
- Can be done with export/import manually

---

### 13. Goal Tracking Tools

**Problem**: No tools for YNAB goals (savings goals, debt payoff).

**Solution**: Tools to view, create, update goals

**Not prioritizing now because**:
- Less commonly used than core budgeting
- Complex to implement well
- YNAB web/mobile already handle this well

---

## Prioritization Matrix

| Improvement | User Impact | Dev Effort | Priority |
|-------------|-------------|------------|----------|
| 1. Performance Instrumentation | High | Low-Med | **HIGH** |
| 2. `ynab-mcp doctor` CLI | High | Medium | **HIGH** |
| 3. Request Coalescing | Medium-High | Medium | **HIGH** |
| 4. Auto-Categorization Rules | High | Medium-High | **HIGH** |
| 5. Reconciliation Health | Medium | Low-Med | HIGH |
| 6. VS Code Snippets | Medium | Low-Med | MEDIUM |
| 7. Fixture Test Suite | Medium | Medium | MEDIUM |
| 8. Mutation Testing | Medium | Low | MEDIUM |
| 9. Tool Catalog Docs | Medium | Low | MEDIUM |
| 10. ADRs | Low-Med | Low-Med | MEDIUM |
| 11. Scheduled Jobs | Low | High | LOW |
| 12. Multi-Budget Transfer | Low | Medium | LOW |
| 13. Goal Tracking | Low | High | LOW |

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)
- ✅ Complete reconciliation redesign
- 🔄 Performance instrumentation (#1)
- 🔄 `ynab-mcp doctor` CLI (#2)

### Phase 2: User-Facing Features (Weeks 5-10)
- Auto-categorization rules (#4)
- Reconciliation health metrics (#5)
- Request coalescing (#3)

### Phase 3: Quality & DX (Weeks 11-14)
- Fixture test suite (#7)
- Mutation testing (#8)
- Tool catalog documentation (#9)
- VS Code snippets (#6)

### Phase 4: Long-Term (Weeks 15+)
- ADRs (#10)
- Evaluate low-priority features based on user feedback

## Success Metrics

**Performance**:
- P95 tool execution time <500ms (down from current unknown)
- Cache hit rate >70% (current ~60%)
- API calls reduced by 30% via coalescing

**Developer Experience**:
- New tool creation time <30 minutes (down from ~2 hours)
- Setup issues resolved via doctor CLI: 90% success rate
- Contributor onboarding time <1 day

**User Experience**:
- Auto-categorization adoption: 50%+ of users
- Reconciliation frequency increase: 2x
- Support tickets decrease: 40%

## Validation with Codex

✅ **Validated by Codex (2025-10-31)**:
- Performance instrumentation approach
- Developer CLI for diagnostics
- Request coalescing for batch operations
- Rule-based automation value
- Reconciliation health metrics
- Documentation catalog need
- Architecture decision records

## Next Steps

1. Get user approval on roadmap priorities
2. Create detailed specifications for Phase 1 items
3. Begin implementation with performance instrumentation
4. Validate with user feedback after each phase

---

**Status**: Ready for user review
**Estimated Timeline**: 14+ weeks for Phases 1-3
**Dependencies**: Reconciliation redesign completion
